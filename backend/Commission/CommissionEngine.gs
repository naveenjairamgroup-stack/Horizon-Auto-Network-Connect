/**
 * CommissionEngine.gs
 * Calculates monthly commission per dealer from Vehicle Sale ledger entries,
 * using the latest applicable rule in Commission_Master, and posts it as a
 * Credit entry (reduces Outstanding) — same as the rest of the ledger.
 *
 * SIMPLIFICATION, flagged rather than guessed at: Commission_Master is
 * defined per Vehicle Model in the original spec, but Ledger_Transactions
 * doesn't currently capture Model on each entry. This engine applies the
 * single most-recent Commission_Master rule to a dealer's total Vehicle
 * Sale volume for the month. If per-model commission is needed later, add
 * a "Model" column to Ledger_Transactions and to this calculation.
 */

function addCommissionRule(token, rule) {
  return safeRun('addCommissionRule', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.edit);
    requireFields(rule, ['Vehicle Model', 'Commission Type', 'Rate', 'Effective Date']);
    if (['Fixed', 'Percentage'].indexOf(rule['Commission Type']) === -1) {
      throw new Error('Commission Type must be Fixed or Percentage.');
    }
    rule['Created By'] = session.username;
    appendRow(SHEETS.COMMISSION_MASTER, rule, session.username);
    return true;
  });
}

function listCommissionRules(token) {
  return safeRun('listCommissionRules', function () {
    requireRole_(token, PERMISSIONS.Commission.view);
    return getAllRows(SHEETS.COMMISSION_MASTER);
  });
}

function calculateCommission(token, dealerCode, month) {
  return safeRun('calculateCommission', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS]);
    if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode)) {
      throw new Error('Dealer not found: ' + dealerCode);
    }
    if (!/^\d{4}-\d{2}$/.test(month || '')) {
      throw new Error('Month must be in YYYY-MM format, e.g. 2026-07.');
    }
    if (findRows(SHEETS.COMMISSION_ENTRIES, { 'Dealer Code': dealerCode, 'Month': month }).length > 0) {
      throw new Error('Commission for ' + dealerCode + ' / ' + month + ' has already been calculated.');
    }
    var rules = getAllRows(SHEETS.COMMISSION_MASTER)
      .filter(function (r) { return new Date(r['Effective Date']) <= new Date(); })
      .sort(function (a, b) { return new Date(b['Effective Date']) - new Date(a['Effective Date']); });
    if (rules.length === 0) throw new Error('No Commission Master rule found. Add one first.');
    var rule = rules[0];

    var vehicleSales = findRows(SHEETS.LEDGER_TRANSACTIONS, { 'Dealer Code': dealerCode, 'Head': 'Vehicle Sale' })
      .filter(function (r) { return Utilities.formatDate(new Date(r.Date), 'Asia/Kolkata', 'yyyy-MM') === month; });

    var retailCount = vehicleSales.length;
    var totalSaleAmount = vehicleSales.reduce(function (sum, r) { return sum + Number(r.Debit || 0); }, 0);
    var amount = rule['Commission Type'] === 'Fixed'
      ? retailCount * Number(rule.Rate)
      : totalSaleAmount * (Number(rule.Rate) / 100);
    amount = Math.round(amount * 100) / 100;

    if (amount > 0) {
      appendRow(SHEETS.COMMISSION_ENTRIES, {
        'Entry ID': generateId('COM'),
        'Dealer Code': dealerCode,
        'Month': month,
        'Model': rule['Vehicle Model'],
        'Retail Count': retailCount,
        'Amount': amount,
        'Created On': new Date()
      }, session.username);

      appendRow(SHEETS.LEDGER_TRANSACTIONS, {
        'Entry ID': generateId('LED'),
        'Date': new Date(),
        'Invoice No': '',
        'Head': 'Commission',
        'Dealer Code': dealerCode,
        'Debit': 0,
        'Credit': amount,
        'Running Balance': 0,
        'Remarks': 'Commission for ' + month + ' (' + retailCount + ' retail)',
        'Created By': session.username,
        'Timestamp': new Date()
      }, session.username);
      recomputeRunningBalance_(dealerCode);
    }
    return { retailCount: retailCount, amount: amount };
  });
}

function listCommissionEntries(token, dealerCode) {
  return safeRun('listCommissionEntries', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.view);
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own commission entries.');
    }
    return findRows(SHEETS.COMMISSION_ENTRIES, { 'Dealer Code': dealerCode });
  });
}

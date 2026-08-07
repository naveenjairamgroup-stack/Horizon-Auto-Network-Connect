/**
 * LedgerService.gs
 * Every Vehicle/Parts bill, approved payment, approved return, and commission
 * credit lands here as one row (Phase 1 supports direct entries by
 * Admin/Accounts; Phase 2's Payments/Returns modules post here automatically
 * once approved — see architecture doc section 6).
 */

function addLedgerEntry(token, entry) {
  return safeRun('addLedgerEntry', function () {
    var session = requireRole_(token, PERMISSIONS.Ledger.edit);
    requireFields(entry, ['Date', 'Head', 'Dealer Code']);
    if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', entry['Dealer Code'])) {
      throw new Error('Dealer not found: ' + entry['Dealer Code']);
    }
    var effect = getHeadEffect_(entry.Head); // throws if head unknown
    var amount = Math.abs(Number(entry.Amount) || 0);
    if (amount === 0) throw new Error('Amount must be greater than zero.');

    var row = {
      'Entry ID': generateId('LED'),
      'Date': entry.Date,
      'Invoice No': entry['Invoice No'] || '',
      'Head': entry.Head,
      'Dealer Code': entry['Dealer Code'],
      'Debit': effect === EFFECT.INCREASE ? amount : 0,
      'Credit': effect === EFFECT.DECREASE ? amount : 0,
      'Running Balance': 0, // recomputed below
      'Remarks': entry.Remarks || '',
      'Created By': session.username,
      'Timestamp': new Date()
    };
    appendRow(SHEETS.LEDGER_TRANSACTIONS, row, session.username);
    recomputeRunningBalance_(entry['Dealer Code']);
    return row;
  });
}

function getLedger(token, dealerCode) {
  return safeRun('getLedger', function () {
    var session = requireRole_(token, PERMISSIONS.Ledger.view);
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own ledger.');
    }
    var rows = findRows(SHEETS.LEDGER_TRANSACTIONS, { 'Dealer Code': dealerCode });
    var fy = getCurrentFinancialYear_();
    var opening = getOpeningBalance(dealerCode, fy);
    if (Number(opening.Amount) > 0) {
      var isDr = opening['Balance Type'] !== 'Cr';
      rows = [{
        'Entry ID': '',
        'Date': opening['Effective Date'] || opening['Set On'] || new Date(),
        'Invoice No': '',
        'Head': 'Opening Balance',
        'Dealer Code': dealerCode,
        'Debit': isDr ? Number(opening.Amount) : 0,
        'Credit': isDr ? 0 : Number(opening.Amount),
        'Running Balance': isDr ? Number(opening.Amount) : -Number(opening.Amount),
        'Remarks': 'Opening balance (' + fy + ')',
        'Created By': opening['Set By'] || '',
        'Timestamp': opening['Set On'] || ''
      }].concat(rows);
    }
    return rows.sort(function (a, b) { return new Date(a.Date) - new Date(b.Date); });
  });
}

/**
 * Recomputes Running Balance for every entry of one dealer, in date order,
 * starting from that dealer's Opening Balance. Called after every add so
 * back-dated entries (e.g. a late Return, Phase 2) keep the ledger correct.
 */
function recomputeRunningBalance_(dealerCode) {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.LEDGER_TRANSACTIONS);
  var headers = getHeaders_(SHEETS.LEDGER_TRANSACTIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var dealerCol = headers.indexOf('Dealer Code');
  var dateCol = headers.indexOf('Date');
  var debitCol = headers.indexOf('Debit');
  var creditCol = headers.indexOf('Credit');
  var balCol = headers.indexOf('Running Balance');

  var fy = getCurrentFinancialYear_();
  var opening = getOpeningBalance(dealerCode, fy);
  var balance = opening['Balance Type'] === 'Cr' ? -Number(opening.Amount) : Number(opening.Amount);

  var indices = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][dealerCol]) === String(dealerCode)) indices.push(i);
  }
  indices.sort(function (a, b) { return new Date(values[a][dateCol]) - new Date(values[b][dateCol]); });

  indices.forEach(function (i) {
    balance = balance + Number(values[i][debitCol] || 0) - Number(values[i][creditCol] || 0);
    sheet.getRange(i + 2, balCol + 1).setValue(balance);
  });
}

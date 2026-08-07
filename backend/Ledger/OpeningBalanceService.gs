/**
 * OpeningBalanceService.gs
 * One opening balance per dealer per financial year, set manually by
 * Accounts/Admin at onboarding — the system never tries to derive this
 * from any historical import, it's a plain entered fact. The Effective
 * Date is when this balance is "as of" (e.g. 01-08-2026, the day this
 * system went live) — getLedger() uses it to show a synthetic "Opening
 * Balance" row dated correctly at the top of the dealer's ledger.
 */

function setOpeningBalance(token, dealerCode, financialYear, amount, balanceType, effectiveDate) {
  return safeRun('setOpeningBalance', function () {
    var session = requireRole_(token, PERMISSIONS.OpeningBalance.edit);
    if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode)) {
      throw new Error('Dealer not found: ' + dealerCode);
    }
    if (['Dr', 'Cr'].indexOf(balanceType) === -1) {
      throw new Error('Balance Type must be Dr (dealer owes Honda) or Cr (Honda owes dealer).');
    }
    if (!isNonEmpty(financialYear)) throw new Error('Financial Year is required, e.g. 2026-27.');
    var existing = findRows(SHEETS.OPENING_BALANCE, { 'Dealer Code': dealerCode, 'Financial Year': financialYear });
    if (existing.length > 0) {
      throw new Error('Opening balance for ' + dealerCode + ' / ' + financialYear + ' is already set. Ask Admin to correct it directly in the sheet if it was entered wrong.');
    }
    var row = {
      'Dealer Code': dealerCode,
      'Financial Year': financialYear,
      'Amount': Math.abs(Number(amount)) || 0,
      'Balance Type': balanceType,
      'Set By': session.username,
      'Set On': new Date(),
      'Effective Date': effectiveDate ? parseInvoiceDate_(effectiveDate) : new Date()
    };
    appendRow(SHEETS.OPENING_BALANCE, row, session.username);
    return row;
  });
}

/** Not exposed directly to the frontend under safeRun — used internally by other services. */
function getOpeningBalance(dealerCode, financialYear) {
  var row = findRows(SHEETS.OPENING_BALANCE, { 'Dealer Code': dealerCode, 'Financial Year': financialYear })[0];
  return row || { Amount: 0, 'Balance Type': 'Dr' };
}

function getCurrentFinancialYear_() {
  var now = new Date();
  var year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY starts April
  return year + '-' + String(year + 1).slice(-2);
}

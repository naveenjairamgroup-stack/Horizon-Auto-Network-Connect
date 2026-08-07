/**
 * OutstandingService.gs
 * Outstanding = Opening Balance + Vehicle/Parts Bills (Debit)
 *             - Payments - Commission - Credit Notes (Credit) + Debit Notes.
 * Positive = dealer owes Honda. Negative = Honda owes the dealer.
 */

function computeOutstanding(token, dealerCode) {
  return safeRun('computeOutstanding', function () {
    var session = requireRole_(token, PERMISSIONS.Ledger.view);
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own outstanding.');
    }
    return computeOutstanding_(dealerCode);
  });
}

/** Internal, unwrapped version — used by other services that already have a valid session. */
function computeOutstanding_(dealerCode) {
  var fy = getCurrentFinancialYear_();
  var opening = getOpeningBalance(dealerCode, fy);
  var balance = opening['Balance Type'] === 'Cr' ? -Number(opening.Amount) : Number(opening.Amount);
  var rows = findRows(SHEETS.LEDGER_TRANSACTIONS, { 'Dealer Code': dealerCode });
  rows.forEach(function (r) {
    balance += Number(r.Debit || 0) - Number(r.Credit || 0);
  });
  return balance;
}

/** Credit-limit traffic light — reused by the Phase 2 Credit Control alerts. */
function getCreditStatus(token, dealerCode) {
  return safeRun('getCreditStatus', function () {
    requireRole_(token, PERMISSIONS.Ledger.view);
    var dealer = findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode);
    if (!dealer) throw new Error('Dealer not found: ' + dealerCode);
    return creditStatusFor_(dealer);
  });
}

/** Internal, unwrapped version — used by getCreditStatus and the Dashboard's dealer-outstanding-summary table so both agree on the same Red/Yellow/Green thresholds. */
function creditStatusFor_(dealer) {
  var outstanding = computeOutstanding_(dealer['Dealer Code']);
  var limit = Number(dealer['Credit Limit']) || 0;
  var usedPct = limit > 0 ? (outstanding / limit) * 100 : 0;
  var status = 'Green';
  if (usedPct >= 100 || (limit - outstanding) < 0) status = 'Red';
  else if (usedPct >= 75) status = 'Yellow';
  return {
    outstanding: outstanding,
    creditLimit: limit,
    availableBalance: limit - outstanding,
    usedPercent: Math.round(usedPct * 10) / 10,
    status: status
  };
}

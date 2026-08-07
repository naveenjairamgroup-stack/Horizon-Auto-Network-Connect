/**
 * DashboardService.gs
 * Aggregates the cards shown on each role's dashboard, in one call so the
 * frontend doesn't need to fire five separate requests.
 */

function getDashboardSummary(token) {
  return safeRun('getDashboardSummary', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER]);
    var dealers = getAllRows(SHEETS.DEALER_MASTER);
    if (session.role === ROLES.DEALER) {
      dealers = dealers.filter(function (d) { return d['Dealer Code'] === session.dealerCode; });
    }
    var totalOutstanding = 0;
    var overLimit = 0;
    dealers.forEach(function (d) {
      var outstanding = computeOutstanding_(d['Dealer Code']);
      totalOutstanding += outstanding;
      var limit = Number(d['Credit Limit']) || 0;
      if (limit > 0 && outstanding > limit) overLimit++;
    });
    return {
      totalDealers: dealers.length,
      totalAD: dealers.filter(function (d) { return d.Type === 'AD'; }).length,
      totalASC: dealers.filter(function (d) { return d.Type === 'ASC'; }).length,
      totalFO: dealers.filter(function (d) { return d.Type === 'FO'; }).length,
      totalOutstanding: totalOutstanding,
      dealersOverLimit: overLimit,
      pendingPayments: findRows(SHEETS.PAYMENT_ENTRIES, { 'Approval Status': APPROVAL_STATUS.PENDING }).length,
      pendingReturns: findRows(SHEETS.RETURN_ENTRIES, { 'Approval Status': APPROVAL_STATUS.PENDING }).length,
      pendingVehicleSaleReviews: findRows(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, { 'Status': 'Pending' }).length,
      pendingPartsSaleReviews: findRows(SHEETS.PARTS_SALE_REVIEW_QUEUE, { 'Status': 'Pending' }).length
    };
  });
}

/**
 * Quick-glance per-dealer table shown below the KPI cards on the Admin,
 * Accounts, and Network Manager dashboards — Dealer Name / Outstanding /
 * Credit Status, so the overall picture is visible the moment the
 * dashboard opens without drilling into each dealer's Ledger. Sorted by
 * outstanding (highest first) since the biggest exposures are the most
 * useful thing to see at a glance.
 */
function listDealerOutstandingSummary(token) {
  return safeRun('listDealerOutstandingSummary', function () {
    requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER]);
    var dealers = getAllRows(SHEETS.DEALER_MASTER).filter(function (d) { return d.Status === 'Active'; });
    return dealers.map(function (d) {
      var cs = creditStatusFor_(d);
      return {
        dealerCode: d['Dealer Code'],
        dealerName: d['Dealer Name'],
        outstanding: cs.outstanding,
        status: cs.status
      };
    }).sort(function (a, b) { return b.outstanding - a.outstanding; });
  });
}

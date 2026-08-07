/**
 * CreditControlService.gs
 * Scans every dealer's credit status and raises a Notification_Log entry
 * whenever a dealer is over their approved limit. Call checkCreditAlerts()
 * manually from the UI, or wire it to a time-driven trigger later
 * (Apps Script editor → Triggers ⏰ → Add Trigger → time-driven).
 */

function checkCreditAlerts(token) {
  return safeRun('checkCreditAlerts', function () {
    requireRole_(token, PERMISSIONS.CreditControl.edit);
    var dealers = getAllRows(SHEETS.DEALER_MASTER);
    var alerts = [];
    dealers.forEach(function (d) {
      var outstanding = computeOutstanding_(d['Dealer Code']);
      var limit = Number(d['Credit Limit']) || 0;
      var available = limit - outstanding;
      if (limit > 0 && available < 0) {
        var message = 'Dealer ' + d['Dealer Name'] + ' (' + d['Dealer Code'] + ') has exceeded the approved credit limit by ' + formatCurrency(-available) + '.';
        appendRow(SHEETS.NOTIFICATION_LOG, {
          'Dealer Code': d['Dealer Code'],
          'Type': 'Credit Limit Exceeded',
          'Message': message,
          'Timestamp': new Date(),
          'Read Status': false
        });
        alerts.push({ dealerCode: d['Dealer Code'], dealerName: d['Dealer Name'], message: message });
      }
    });
    return alerts;
  });
}

function getNotifications(token) {
  return safeRun('getNotifications', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER]);
    var rows = getAllRows(SHEETS.NOTIFICATION_LOG);
    if (session.role === ROLES.DEALER) {
      rows = rows.filter(function (r) { return r['Dealer Code'] === session.dealerCode; });
    }
    return rows.sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); }).slice(0, 50);
  });
}

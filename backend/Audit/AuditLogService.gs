/**
 * AuditLogService.gs
 * Every create/update in the system is recorded here automatically by
 * SheetHelper.gs. Nothing in this table is ever deleted.
 */

function logAction(user, action, oldValue, newValue) {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.AUDIT_LOG);
  sheet.appendRow([new Date(), user, action, oldValue || '', newValue || '']);
}

function getAuditLog(token, filters) {
  return safeRun('getAuditLog', function () {
    requireRole_(token, [ROLES.ADMIN]);
    var rows = getAllRows(SHEETS.AUDIT_LOG);
    if (filters && filters.user) {
      rows = rows.filter(function (r) { return r.User === filters.user; });
    }
    return rows.sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  });
}

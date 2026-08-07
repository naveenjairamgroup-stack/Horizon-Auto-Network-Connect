/**
 * ErrorHandler.gs
 * Wraps a service function so failures are logged to Error_Log and returned
 * to the frontend as a clean { success:false, error } object instead of a
 * raw Apps Script exception page.
 */

function safeRun(context, fn) {
  try {
    return ok(fn());
  } catch (err) {
    logError_(context, err);
    return fail(err && err.message ? err.message : String(err));
  }
}

function logError_(context, err) {
  try {
    var sheet = getSpreadsheet().getSheetByName(SHEETS.ERROR_LOG);
    sheet.appendRow([new Date(), context, (err && err.message) || String(err), (err && err.stack) || '']);
  } catch (e) {
    Logger.log('Failed to log error: ' + e.message);
  }
}

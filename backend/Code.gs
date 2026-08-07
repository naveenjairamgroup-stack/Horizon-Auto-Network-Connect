/**
 * Code.gs
 * Entry point for the Horizon Auto — Network Connect backend, deployed as
 * an Apps Script Web App and called as a plain JSON HTTP API.
 *
 * ---------------------------------------------------------------------
 * WHY THIS LOOKS DIFFERENT FROM A TYPICAL APPS SCRIPT WEB APP
 * ---------------------------------------------------------------------
 * The frontend now lives on Cloudflare Pages (a different domain), not
 * inside Apps Script's own HtmlService. That means `google.script.run` —
 * the usual way an Apps Script HTML page talks to its backend — is not
 * available here at all; it only works when the HTML is served BY Apps
 * Script itself. So this backend is called instead as an ordinary HTTP
 * JSON API, the same way you'd call any REST endpoint from a browser.
 *
 * Request shape (POST, sent by frontend/assets/js/api.js):
 *   Content-Type: text/plain;charset=utf-8   (deliberately NOT
 *     application/json — that content type forces the browser to send a
 *     CORS "preflight" OPTIONS request first, and Apps Script Web Apps
 *     have no way to answer an OPTIONS request. text/plain is treated by
 *     the browser as a "simple request", so no preflight happens and the
 *     call just works.)
 *   Body: {"fn": "listDealers", "args": [token, ...]}
 *
 * Response: {"success": true, "data": ...} or {"success": false, "error": "..."}
 * exactly the same shape safeRun() already produced before — the business
 * logic and its wrapping are completely unchanged, only the transport
 * around them is new.
 *
 * GET requests with ?fn=...&args=... are also accepted, purely so a
 * function can be poked directly from a browser address bar while
 * debugging. The real frontend always uses POST (see api.js).
 * ---------------------------------------------------------------------
 */

/**
 * The explicit list of callable functions, mapped directly to the real
 * function references. This is both the router AND the security boundary:
 * anything not listed here — including every internal helper whose name
 * ends in an underscore, like requireRole_ or computeOutstanding_ — simply
 * cannot be reached from the outside, no matter what a caller sends. Keep
 * this in sync with the api() calls in the frontend; the deployment guide
 * has a note on updating this when adding a new backend function.
 */
var API_DISPATCH = {
  login: login,
  logout: logout,
  resetPassword: resetPassword,

  listDealers: listDealers,
  createDealer: createDealer,
  updateDealer: updateDealer,

  listUsers: listUsers,
  createUser: createUser,
  setUserActive: setUserActive,

  listVoucherHeads: listVoucherHeads,

  getLedger: getLedger,
  addLedgerEntry: addLedgerEntry,
  setOpeningBalance: setOpeningBalance,
  getCreditStatus: getCreditStatus,
  computeOutstanding: computeOutstanding,

  submitPayment: submitPayment,
  listPayments: listPayments,
  approvePayment: approvePayment,
  rejectPayment: rejectPayment,

  submitReturn: submitReturn,
  listReturns: listReturns,
  approveReturn: approveReturn,
  rejectReturn: rejectReturn,

  calculateCommission: calculateCommission,
  listCommissionRules: listCommissionRules,
  addCommissionRule: addCommissionRule,
  listCommissionEntries: listCommissionEntries,

  getDashboardSummary: getDashboardSummary,
  listDealerOutstandingSummary: listDealerOutstandingSummary,

  getAuditLog: getAuditLog,

  listVehicleSaleReviews: listVehicleSaleReviews,
  submitVehicleSaleReview: submitVehicleSaleReview,

  listPartsSaleReviewQueue: listPartsSaleReviewQueue,
  assignPartsSaleReview: assignPartsSaleReview,

  runImportNow: runImportNow,
  getImportLog: getImportLog,

  getInvoiceDetail: getInvoiceDetail,
  getInventoryDetail: getInventoryDetail,

  uploadAttachment: uploadAttachment
};

function doPost(e) {
  return handleApiRequest_(e);
}

/**
 * GET is a debugging convenience only (e.g. paste a URL like
 * ?fn=listVoucherHeads&args=%5B%22TOKEN%22%5D straight into a browser).
 * With no ?fn= at all, it just reports that the API is alive — useful for
 * confirming the deployment URL is correct without needing a real token.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.fn) {
    return handleApiRequest_(e);
  }
  return jsonOutput_({
    success: true,
    message: 'Horizon Auto — Network Connect API is running. Send POST requests from the frontend app.'
  });
}

function handleApiRequest_(e) {
  var fn, args, callback;
  try {
    if (e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      fn = body.fn;
      args = body.args || [];
      callback = e.parameter && e.parameter.callback;
    } else if (e.parameter && e.parameter.fn) {
      fn = e.parameter.fn;
      args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
      callback = e.parameter.callback;
    } else {
      return jsonOutput_({ success: false, error: 'No function name (fn) supplied.' });
    }
  } catch (parseErr) {
    return jsonOutput_({ success: false, error: 'Bad request — could not parse JSON: ' + parseErr.message }, callback);
  }

  var target = API_DISPATCH[fn];
  if (typeof target !== 'function') {
    return jsonOutput_({ success: false, error: 'Unknown or unauthorized function: ' + fn }, callback);
  }

  try {
    var result = target.apply(null, args);
    return jsonOutput_(result, callback);
  } catch (err) {
    return jsonOutput_({ success: false, error: err.message }, callback);
  }
}

function jsonOutput_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
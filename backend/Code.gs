/**
 * Code.gs
 * Entry point for the Horizon Auto — Network Connect backend, deployed as
 * an Apps Script Web App and called as a plain JSON HTTP API.
 *
 * ---------------------------------------------------------------------
 * WHY THIS LOOKS DIFFERENT FROM A TYPICAL APPS SCRIPT WEB APP
 * ---------------------------------------------------------------------
 * The frontend lives on Cloudflare Pages (a different domain), not inside
 * Apps Script's own HtmlService, so `google.script.run` isn't available —
 * it only works when the HTML is served BY Apps Script itself.
 *
 * The browser never calls this URL directly. It calls a Cloudflare Pages
 * Function at /api (frontend/functions/api.js), which forwards the request
 * to here server-side. Server-to-server requests aren't subject to browser
 * CORS rules, so this sidesteps a CORS/ORB quirk this particular Workspace
 * deployment has with direct browser calls — see api.js's comment for the
 * full story.
 *
 * Request shape (POST, sent by the Cloudflare Function):
 *   Content-Type: text/plain;charset=utf-8
 *   Body: {"fn": "listDealers", "args": [token, ...]}
 *
 * Response: {"success": true, "data": ...} or {"success": false, "error": "..."}
 * exactly the same shape safeRun() already produced before — the business
 * logic and its wrapping are completely unchanged, only the transport
 * around them is new.
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
  findLedgerEntriesByInvoice: findLedgerEntriesByInvoice,
  deleteLedgerEntries: deleteLedgerEntries,

  submitPayment: submitPayment,
  listPayments: listPayments,
  approvePayment: approvePayment,
  rejectPayment: rejectPayment,

  submitReturn: submitReturn,
  listReturns: listReturns,
  approveReturn: approveReturn,
  rejectReturn: rejectReturn,

  // ---- Network commission (ASC vehicle commission) ----
  listCommissionRates: listCommissionRates,
  getCommissionRateHistory: getCommissionRateHistory,
  saveCommissionRate: saveCommissionRate,
  listCommissionConfig: listCommissionConfig,
  setCommissionConfig: setCommissionConfig,
  getCommissionPinStatus: getCommissionPinStatus,
  setCommissionPin: setCommissionPin,
  verifyCommissionPin: verifyCommissionPin,
  runCommissionCheckpoint: runCommissionCheckpoint,
  generateCommissionReport: generateCommissionReport,
  generateAllCommissionReports: generateAllCommissionReports,
  listCommissionReports: listCommissionReports,
  getCommissionReportDetail: getCommissionReportDetail,
  requestCommissionInvoice: requestCommissionInvoice,
  saveCommissionInvoiceDraft: saveCommissionInvoiceDraft,
  uploadCommissionInvoice: uploadCommissionInvoice,
  getCommissionInvoiceHtml: getCommissionInvoiceHtml,
  getCommissionPdf: getCommissionPdf,
  verifyCommissionInvoice: verifyCommissionInvoice,

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
    message: 'Horizon Auto — Network Connect API is running. The app calls this via POST through a Cloudflare Pages Function proxy.'
  });
}

function handleApiRequest_(e) {
  var fn, args;
  try {
    if (e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      fn = body.fn;
      args = body.args || [];
    } else if (e.parameter && e.parameter.fn) {
      fn = e.parameter.fn;
      args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
    } else {
      return jsonOutput_({ success: false, error: 'No function name (fn) supplied.' });
    }
  } catch (parseErr) {
    return jsonOutput_({ success: false, error: 'Bad request — could not parse JSON: ' + parseErr.message });
  }

  var target = API_DISPATCH[fn];
  if (typeof target !== 'function') {
    return jsonOutput_({ success: false, error: 'Unknown or unauthorized function: ' + fn });
  }

  try {
    var result = target.apply(null, args);
    return jsonOutput_(result);
  } catch (err) {
    // Business-logic functions already catch their own errors via safeRun()
    // and return {success:false, error:...} normally: this catch only
    // matters for something unexpected escaping that (e.g. a bad argument
    // count), so the caller still gets clean JSON instead of a raw 500.
    return jsonOutput_({ success: false, error: err.message });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
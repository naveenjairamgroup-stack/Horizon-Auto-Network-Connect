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
  // ---- Review, bulk entry, uploads, settings ----
  listLedgerDuplicates: listLedgerDuplicates,
  getSidebarCounts: getSidebarCounts,
  postBulkLedgerEntries: postBulkLedgerEntries,
  uploadImportFile: uploadImportFile,
  getImportStatus: getImportStatus,
  listImportUploads: listImportUploads,
  listSettings: listSettings,
  saveSetting: saveSetting,

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
    var result = DEDUPED_WRITES[fn] ? runDeduped_(fn, args, target) : target.apply(null, args);
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

// ===================================================== REQUEST DE-DUPLICATION =
/**
 * Write calls that must not be applied twice when the same request arrives
 * twice. Two things cause that, and both were producing duplicate payments:
 *
 *  1. A double click on Submit — two identical requests a few hundred
 *     milliseconds apart.
 *  2. The Cloudflare proxy's retry. If Apps Script has already WRITTEN the
 *     row but the response comes back garbled, the proxy treats the call as
 *     failed and sends it again — and a second row is written with nobody
 *     having clicked anything.
 *
 * The fix keys each call on its function name + exact arguments (token
 * included, so two different users never collide). The first arrival runs;
 * an identical one within DEDUP_TTL_SECONDS gets the first one's result
 * back instead of running again. Failures are not remembered, so a
 * genuinely failed call can always be retried.
 *
 * Deliberately NOT in this list: anything where repeating identical
 * arguments is legitimate — e.g. generateCommissionReport, where pressing
 * Regenerate again after fixing data must actually regenerate.
 */
var DEDUPED_WRITES = {
  submitPayment: true, approvePayment: true, rejectPayment: true,
  submitReturn: true, approveReturn: true, rejectReturn: true,
  addLedgerEntry: true, postBulkLedgerEntries: true, deleteLedgerEntries: true,
  createDealer: true, createUser: true,
  submitVehicleSaleReview: true, assignPartsSaleReview: true,
  requestCommissionInvoice: true, uploadCommissionInvoice: true, verifyCommissionInvoice: true,
  uploadImportFile: true, uploadAttachment: true
};
var DEDUP_TTL_SECONDS = 120;

function runDeduped_(fn, args, target) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, fn + '|' + JSON.stringify(args), Utilities.Charset.UTF_8);
  var key = 'dedup:' + Utilities.base64EncodeWebSafe(digest);
  var cache = CacheService.getScriptCache();

  // Claim the key under a short lock so two near-simultaneous arrivals can't
  // both see "not claimed". The lock is held only for the claim itself —
  // never across the business call, which may take its own lock.
  var existing;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    existing = cache.get(key);
    if (!existing) cache.put(key, 'PENDING', DEDUP_TTL_SECONDS);
  } finally {
    lock.releaseLock();
  }

  if (existing) {
    // Same request already in flight or done — wait for its result.
    for (var i = 0; i < 60 && existing === 'PENDING'; i++) {
      Utilities.sleep(500);
      existing = cache.get(key);
    }
    if (existing && existing !== 'PENDING') {
      try { return JSON.parse(existing); } catch (e) { /* fall through */ }
    }
    return { success: false, error: 'This request is already being processed. Please wait a moment and refresh.' };
  }

  var result;
  try {
    result = target.apply(null, args);
  } catch (err) {
    cache.remove(key);
    throw err;
  }
  if (result && result.success) {
    try { cache.put(key, JSON.stringify(result), DEDUP_TTL_SECONDS); }
    catch (e) { cache.put(key, JSON.stringify({ success: true, data: null }), DEDUP_TTL_SECONDS); } // result too big for cache
  } else {
    cache.remove(key);
  }
  return result;
}

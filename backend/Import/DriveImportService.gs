/**
 * DriveImportService.gs
 * Shared infrastructure for the Drive-based auto-import feature:
 *   - Drive folder setup (one root folder, 3 subfolders)
 *   - Time-driven triggers (12:00 and 16:00 daily) + a manual "Import Now" entry point
 *   - Generic file-reading helpers (handles the two raw export formats we see:
 *     UTF-16 tab-separated with BOM for Vehicle_Sale/Inter_Dealer_Sale exports,
 *     and UTF-8 comma-separated with BOM for the Sales Tax Report)
 *   - Name normalization used by both the Parts and Vehicle Sale (ASC) matchers
 *
 * The three actual parsers/importers live in:
 *   InterDealerSaleImport (this file, AD vehicles)  -- see runInterDealerSaleImport_
 *   VehicleSaleImport.gs   (ASC vehicles, review queue)
 *   PartsSaleImport.gs     (parts/labour)
 */

// ============================================================ FOLDER SETUP =
/**
 * Run ONCE from the Apps Script editor. Creates (or finds) the root
 * "Honda Network ERP - Imports" folder in your Drive, with three subfolders
 * inside: Vehicle_Sale, Parts, Inter_Dealer. Prints the folder link to the
 * execution log so you can go drop files into the right subfolder.
 */
function setupImportFolders() {
  var root = getImportRootFolder_();
  Object.keys(IMPORT_SUBFOLDERS).forEach(function (key) {
    getImportSubfolder_(IMPORT_SUBFOLDERS[key]);
  });
  Logger.log('Import folders ready. Open this folder and use the 3 subfolders inside: ' + root.getUrl());
}

function getImportRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('IMPORT_ROOT_FOLDER_ID');
  var folder = null;
  if (id) {
    try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder('Honda Network ERP - Imports');
    props.setProperty('IMPORT_ROOT_FOLDER_ID', folder.getId());
  }
  return folder;
}

function getImportSubfolder_(name) {
  var root = getImportRootFolder_();
  var it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return root.createFolder(name);
}

// ================================================================ TRIGGERS =
/**
 * Run ONCE from the Apps Script editor. Sets up two daily time-driven
 * triggers (12:00 and 16:00) that call runAllImports_() automatically.
 * Safe to re-run — it removes any triggers it previously created for this
 * function before adding fresh ones, so you never end up with duplicates.
 */
function setupImportTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledImportRun_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('scheduledImportRun_').timeBased().atHour(12).everyDays(1).create();
  ScriptApp.newTrigger('scheduledImportRun_').timeBased().atHour(16).everyDays(1).create();
  Logger.log('Import triggers set for 12:00 and 16:00 daily.');
}

/**
 * Called by the time-driven triggers only.
 *
 * Switched off by default: imports now come in through the portal upload
 * (UploadImportService.gs), which checks columns and refuses a file it has
 * already imported. The Drive run re-read every file in the folder on every
 * run, which is what kept re-applying old cancellations. The triggers can
 * stay in place harmlessly — this returns at once unless Admin turns
 * "Drive folder auto-import" back on in Settings. To remove the triggers
 * outright, run disableDriveImportTriggers() once from the editor.
 */
function scheduledImportRun_() {
  if (getSetting_('DRIVE_IMPORT_ENABLED') !== 'true') {
    Logger.log('Drive auto-import is off (Settings). Skipped.');
    return;
  }
  runAllImports_('Scheduled');
}

/** The old "Import Now" (Drive folders). Same switch as the schedule. */
function runImportNow(token) {
  return safeRun('runImportNow', function () {
    var session = requireRole_(token, PERMISSIONS.Import.run);
    if (getSetting_('DRIVE_IMPORT_ENABLED') !== 'true') {
      throw new Error('Drive folder import is switched off. Upload the file in the Imports tab instead.');
    }
    return runAllImports_(session.username);
  });
}

/** Run once from the editor to delete the twice-daily Drive import triggers. */
function disableDriveImportTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledImportRun_') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n + ' Drive import trigger(s) removed.');
}

/** Runs all three importers in turn and returns a combined summary. */
function runAllImports_(actor) {
  var results = [];
  results.push(runInterDealerSaleImport_(actor));
  results.push(runAscVehicleSaleImport_(actor));
  results.push(runPartsSaleImport_(actor));
  results.push(runStockImport_(actor));
  return results;
}

// ========================================================= FILE READING ===
/** Every file in a folder, newest first. */
function listFilesInFolder_(folderName) {
  var folder = getImportSubfolder_(folderName);
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  return files;
}

/**
 * Reads a UTF-16LE, tab-separated export (Vehicle_Sale.csv / Inter_Dealer_Sale.csv
 * style files) into an array of row-objects keyed by the file's own header row.
 */
function readTsvUtf16File_(file) {
  var text = file.getBlob().getDataAsString('UTF-16LE');
  if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
  var rows = Utilities.parseCsv(text, '\t');
  return rowsToObjects_(rows);
}

/**
 * Reads a UTF-8, comma-separated export (Sales Tax Report style) into an
 * array of row-objects keyed by the file's own header row.
 */
function readCsvUtf8File_(file) {
  var text = file.getBlob().getDataAsString('UTF-8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
  var rows = Utilities.parseCsv(text);
  return rowsToObjects_(rows);
}

function rowsToObjects_(rows) {
  if (!rows || rows.length < 2) return [];
  var headers = rows[0];
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row.length === 1 && row[0] === '') continue; // trailing blank line
    var obj = {};
    headers.forEach(function (h, c) { obj[h.trim()] = row[c] !== undefined ? row[c] : ''; });
    out.push(obj);
  }
  return out;
}

/** Groups an array of row-objects by a key field, preserving row order within each group. */
function groupBy_(rows, keyField) {
  var groups = {};
  var order = [];
  rows.forEach(function (r) {
    var key = r[keyField];
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(r);
  });
  return { groups: groups, order: order };
}

/**
 * Parses the various "Invoice Date" formats seen across the three raw
 * import files into a real JS Date object, so Ledger storage/sorting is
 * consistent regardless of which report it came from:
 *   - "01-08-2026 17:20"          (Vehicle_Sale.csv — DD-MM-YYYY HH:mm)
 *   - "04/08/2026 04:01:41 PM"    (Inter_Dealer_Sale.csv — DD/MM/YYYY hh:mm:ss AM/PM)
 *   - "2026-08-01 00:00:00"       (Sales Tax Report — YYYY-MM-DD HH:mm:ss, unambiguous)
 * Deliberately does NOT hand DD/MM strings straight to `new Date(...)` —
 * JavaScript's built-in parser assumes MM/DD and would silently swap day
 * and month for anything past the 12th, corrupting the date without error.
 */
function parseInvoiceDate_(raw) {
  if (!raw) return new Date();
  if (raw instanceof Date) return raw;
  var s = String(raw).trim();
  if (!s) return new Date();

  // YYYY-MM-DD [HH:mm:ss] — already unambiguous, safe to hand to Date directly.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var d1 = new Date(s.replace(' ', 'T'));
    if (!isNaN(d1)) return d1;
  }

  // DD/MM/YYYY or DD-MM-YYYY, optionally with a time and AM/PM.
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?/i);
  if (m) {
    var day = parseInt(m[1], 10);
    var month = parseInt(m[2], 10) - 1;
    var year = parseInt(m[3], 10);
    var hour = m[4] ? parseInt(m[4], 10) : 0;
    var minute = m[5] ? parseInt(m[5], 10) : 0;
    var second = m[6] ? parseInt(m[6], 10) : 0;
    var ampm = m[7];
    if (ampm) {
      if (/PM/i.test(ampm) && hour < 12) hour += 12;
      if (/AM/i.test(ampm) && hour === 12) hour = 0;
    }
    return new Date(year, month, day, hour, minute, second);
  }

  var fallback = new Date(s);
  return isNaN(fallback) ? new Date() : fallback;
}

/**
 * Robustly parses a numeric amount out of raw import-file text. The exports
 * are inconsistent about formatting the SAME kind of number even within one
 * file/row — seen so far: "Rs.57,284.00", "79,060.39", "93291.2543", and
 * plain numbers. Plain Number(...) returns NaN on the first two (which
 * silently becomes 0 via `|| 0`), which is exactly why Finance Amount and
 * other money fields were showing as 0. Strips a "Rs." prefix and any comma
 * thousands-separators before parsing, so every one of these formats (and
 * genuinely-already-clean numbers, including numbers typed by a human into
 * the All Model Price List sheet) comes out right.
 */
function parseAmount_(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return raw;
  var cleaned = String(raw).replace(/["']/g, '').replace(/rs\.?/gi, '').replace(/,/g, '').trim();
  var n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Normalizes a Model Variant name for matching against the All Model Price
 * List — more forgiving than normalizeName_ below: it also turns hyphens
 * into spaces, so "ACTIVA DLX-OBD2B" (as it appears in the raw Stock file)
 * still matches "ACTIVA DLX OBD2B" (if Admin typed it with a space instead
 * of a hyphen in the price list) without needing character-perfect entry.
 */
function normalizeModelVariant_(variant) {
  return String(variant || '')
    .toUpperCase()
    .replace(/[-.\/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===================================================== NAME NORMALIZATION =
/**
 * Used to match a report's "Account Name" / "Assigned To (DSE) Name" against
 * Dealer_Master's Dealer Name / Vehicle Sale Alias: uppercase, drop "M/S"
 * prefix, drop punctuation, collapse whitespace. Intentionally NOT fuzzy
 * (no partial/similarity matching) — a financial system should never guess
 * at which dealer a transaction belongs to.
 */
function normalizeName_(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/M\/S\.?\s*/g, '')
    .replace(/[.\/,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGst_(gst) {
  return String(gst || '').toUpperCase().replace(/\s+/g, '').trim();
}

/** Finds a Dealer_Master row by exact GSTIN match. Returns null if not found or gst is blank. */
function findDealerByGst_(gst) {
  var norm = normalizeGst_(gst);
  if (!norm) return null;
  var dealers = getAllRows(SHEETS.DEALER_MASTER);
  for (var i = 0; i < dealers.length; i++) {
    if (normalizeGst_(dealers[i].GST) === norm) return dealers[i];
  }
  return null;
}

/** Finds a Dealer_Master row by normalized Dealer Name match. Returns null if not found. */
function findDealerByName_(name) {
  var norm = normalizeName_(name);
  if (!norm) return null;
  var dealers = getAllRows(SHEETS.DEALER_MASTER);
  for (var i = 0; i < dealers.length; i++) {
    if (normalizeName_(dealers[i]['Dealer Name']) === norm) return dealers[i];
  }
  return null;
}

/** Finds a Dealer_Master row by normalized "Vehicle Sale Alias" match. Returns null if not found. */
function findDealerByVehicleSaleAlias_(alias) {
  var norm = normalizeName_(alias);
  if (!norm) return null;
  var dealers = getAllRows(SHEETS.DEALER_MASTER);
  for (var i = 0; i < dealers.length; i++) {
    if (normalizeName_(dealers[i]['Vehicle Sale Alias']) === norm) return dealers[i];
  }
  return null;
}

/** Finds a Dealer_Master row by normalized "Inventory Location Alias" match. Returns null if not found. */
function findDealerByInventoryAlias_(location) {
  var norm = normalizeName_(location);
  if (!norm) return null;
  var dealers = getAllRows(SHEETS.DEALER_MASTER);
  for (var i = 0; i < dealers.length; i++) {
    if (normalizeName_(dealers[i]['Inventory Location Alias']) === norm) return dealers[i];
  }
  return null;
}

// ============================================================== IMPORT LOG =
function logImportRun_(fileName, folderType, processed, skipped, updated, reversed, status) {
  appendRow(SHEETS.IMPORT_LOG, {
    'File Name': fileName,
    'Upload Time': new Date(),
    'Records Processed': processed,
    'Duplicates Skipped': skipped,
    'Status': status,
    'Folder Type': folderType,
    'Updated Count': updated,
    'Reversed Count': reversed
  }, 'System');
}

function getImportLog(token) {
  return safeRun('getImportLog', function () {
    requireRole_(token, PERMISSIONS.Import.view);
    return getAllRows(SHEETS.IMPORT_LOG).sort(function (a, b) { return new Date(b['Upload Time']) - new Date(a['Upload Time']); }).slice(0, 100);
  });
}

// ======================================================== LEDGER REVERSAL =
/**
 * Posts a same-amount opposite entry against an already-posted invoice, so
 * the original entry is never edited/deleted (full audit trail) but its
 * effect is cancelled out. Used for both "Cancelled in file" and
 * "data changed, re-importing corrected version" cases.
 */
/**
 * Net position of one invoice on one ledger head: total Debit minus total
 * Credit across every row for that dealer + invoice + head.
 */
function ledgerNetForInvoice_(dealerCode, invoiceNo, head) {
  var net = 0;
  getAllRows(SHEETS.LEDGER_TRANSACTIONS).forEach(function (r) {
    if (String(r['Dealer Code']) !== String(dealerCode)) return;
    if (String(r['Invoice No']) !== String(invoiceNo)) return;
    if (String(r.Head) !== String(head)) return;
    net += (Number(r.Debit) || 0) - (Number(r.Credit) || 0);
  });
  return net;
}

/**
 * Posts the opposite entry for an invoice, so the original stays in the
 * ledger and the pair nets it to zero.
 *
 * IDEMPOTENT. Before this guard, a cancelled invoice reversed again on every
 * single import run that still contained it — the detail rows that mark it
 * as "already imported" are never removed, so each run saw it afresh and
 * posted yet another credit. With files never moved out of the import folder
 * that compounded twice a day. The ledger itself is now the source of truth:
 * if the invoice's remaining balance on this head is already zero, there is
 * nothing left to reverse and nothing is written. It also never reverses more
 * than what is still outstanding.
 *
 * Returns true if an entry was written, false if it was already reversed.
 */
function reverseLedgerEntry_(originalHead, dealerCode, invoiceNo, amount, wasDebit, reason) {
  var net = ledgerNetForInvoice_(dealerCode, invoiceNo, originalHead);
  var outstanding = wasDebit ? net : -net;
  var amt = Math.min(Math.abs(Number(amount) || 0), outstanding);
  if (!(amt > 0.005)) return false;

  var row = {
    'Entry ID': generateId('LED'),
    'Date': new Date(),
    'Invoice No': invoiceNo,
    'Head': originalHead,
    'Dealer Code': dealerCode,
    'Debit': wasDebit ? 0 : amt,
    'Credit': wasDebit ? amt : 0,
    'Running Balance': 0,
    'Remarks': reason,
    'Created By': 'System (Import)',
    'Timestamp': new Date()
  };
  appendRow(SHEETS.LEDGER_TRANSACTIONS, row, 'System (Import)');
  recomputeRunningBalance_(dealerCode);
  return true;
}

/** Adds one importer's per-file counts into a running total. */
function addCounts_(total, c) {
  ['processed', 'skipped', 'updated', 'reversed'].forEach(function (k) { total[k] += (c[k] || 0); });
  return total;
}

function newCounts_() { return { processed: 0, skipped: 0, updated: 0, reversed: 0 }; }

/**
 * Powers the "view details" popup on a Ledger row. Vehicle Sale / Finance
 * Company Advance rows return the frame list (+ the Network Manager's
 * review breakdown, if it's an ASC-sourced entry). Parts Sale rows return
 * the part/labour line items. Anything else returns type:'none' (a manually
 * entered ledger row, nothing extra to show).
 */
function getInvoiceDetail(token, invoiceNo, dealerCode, head) {
  return safeRun('getInvoiceDetail', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER]);
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own invoices.');
    }
    if (head === 'Vehicle Sale' || head === 'Finance Company Advance') {
      var frames = findRows(SHEETS.VEHICLE_SALE_DETAIL, { 'Invoice No': invoiceNo, 'Dealer Code': dealerCode });
      var reviewRow = findRow(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Invoice No', invoiceNo);
      return { type: 'vehicle', frames: frames, review: reviewRow };
    }
    if (head === 'Parts Sale') {
      var lines = findRows(SHEETS.PARTS_SALE_DETAIL, { 'Invoice No': invoiceNo, 'Dealer Code': dealerCode });
      return { type: 'parts', lines: lines };
    }
    return { type: 'none' };
  });
}

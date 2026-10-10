/**
 * UploadImportService.gs
 * Importing a DMS export by uploading it in the portal, instead of dropping
 * it in a Drive folder.
 *
 * The four importers are unchanged in what they DO — each was split into a
 * "process these parsed rows" function (processInterDealerRows_ and friends)
 * which both this upload and the old Drive run call. What is new here:
 *
 *  - COLUMNS ARE CHECKED. Columns may be in any order, and names match
 *    ignoring case and extra spaces — but every required column must be
 *    present, or the file is refused with the missing names listed. A
 *    missing column used to mean silently blank values, not an error.
 *  - THE SAME FILE CANNOT BE IMPORTED TWICE. Its SHA-256 is recorded on
 *    success; uploading identical bytes again is refused with when and by
 *    whom it was first imported. (A file that FAILED can be uploaded again.)
 *  - "DATA TILL" is recorded: the latest invoice date in the file, or the
 *    upload date for a stock snapshot.
 */

/** Rows with no value in this column are summary/blank lines, not data. */
var IMPORT_KEY_COLUMN = {
  INTER_DEALER: 'Invoice Number',
  VEHICLE_SALE: 'Invoice #',
  PARTS: 'Invoice Number',
  STOCK: 'Frame #'
};

function uploadImportFile(token, importType, fileName, base64) {
  return safeRun('uploadImportFile', function () {
    var session = requireRole_(token, PERMISSIONS.Import.run);
    var spec = IMPORT_TYPES[importType];
    if (!spec) throw new Error('Choose what kind of file this is.');
    if (!base64) throw new Error('No file was received. Please choose the file again.');

    var bytes = Utilities.base64Decode(base64);
    if (bytes.length > IMPORT_MAX_BYTES) {
      throw new Error('This file is ' + (bytes.length / 1048576).toFixed(1) + ' MB. The limit is ' +
        (IMPORT_MAX_BYTES / 1048576) + ' MB — export a shorter date range and upload it in parts.');
    }

    var hash = sha256Hex_(bytes);
    var prior = getAllRows(SHEETS.IMPORT_FILE_LOG).filter(function (r) {
      return r['File Hash'] === hash && r.Status === 'Success';
    })[0];
    if (prior) {
      throw new Error('This exact file was already imported on ' +
        Utilities.formatDate(new Date(prior['Uploaded On']), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm') +
        ' by ' + prior['Uploaded By'] + ' (as ' + (IMPORT_TYPES[prior['Import Type']] || {}).label +
        ', file "' + prior['File Name'] + '"). Nothing was changed.');
    }

    var rows = parseUploadedCsv_(bytes);
    if (!rows.length) {
      return rejectUpload_(hash, fileName, importType, session.username,
        'The file has no data rows. Check that it is the CSV exported from DMS, not an empty sheet.');
    }

    var mapped = canonicalizeHeaders_(rows, spec);
    if (mapped.missing.length) {
      return rejectUpload_(hash, fileName, importType, session.username,
        'Required column' + (mapped.missing.length > 1 ? 's' : '') + ' not found: ' + mapped.missing.join(', ') +
        '. Columns in this file: ' + mapped.found.slice(0, 40).join(', ') + (mapped.found.length > 40 ? ' …' : '') +
        '. Is this the right file type?');
    }

    var keyCol = IMPORT_KEY_COLUMN[importType];
    var dataRows = mapped.rows.filter(function (r) { return String(r[keyCol] || '').trim() !== ''; });
    var ignored = mapped.rows.length - dataRows.length;
    if (!dataRows.length) {
      return rejectUpload_(hash, fileName, importType, session.username,
        'Every row has an empty "' + keyCol + '". No data to import.');
    }

    var dataTill = new Date();
    if (spec.dateColumn) {
      var latest = null;
      dataRows.forEach(function (r) {
        if (!r[spec.dateColumn]) return;
        var d = parseInvoiceDate_(r[spec.dateColumn]);
        if (!isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
      });
      if (!latest) {
        return rejectUpload_(hash, fileName, importType, session.username,
          'No readable date found in "' + spec.dateColumn + '". Dates are expected like 25-07-2026 or 25/07/2026.');
      }
      dataTill = latest;
    }

    var counts;
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (importType === 'INTER_DEALER') counts = processInterDealerRows_(dataRows);
      else if (importType === 'VEHICLE_SALE') counts = processAscVehicleRows_(dataRows);
      else if (importType === 'PARTS') counts = processPartsRows_(dataRows);
      else counts = processStockRows_(dataRows, new Date());
    } finally {
      lock.releaseLock();
    }

    logImportRun_(fileName, spec.logFolder, counts.processed, counts.skipped, counts.updated || 0, counts.reversed || 0, 'Success');
    appendRow(SHEETS.IMPORT_FILE_LOG, {
      'File Hash': hash, 'File Name': fileName, 'Import Type': importType,
      'Uploaded On': new Date(), 'Uploaded By': session.username, 'Data Till': dataTill,
      'Processed': counts.processed, 'Skipped': counts.skipped,
      'Updated': counts.updated || 0, 'Reversed': counts.reversed || 0,
      'Status': 'Success', 'Error': ''
    }, session.username);

    return {
      importType: importType, label: spec.label, fileName: fileName,
      rows: dataRows.length, ignoredRows: ignored,
      processed: counts.processed, skipped: counts.skipped,
      updated: counts.updated || 0, reversed: counts.reversed || 0,
      dataTill: dataTill
    };
  });
}

/** Logs a refused upload (so there is a trail) and throws its reason to the user. */
function rejectUpload_(hash, fileName, importType, actor, reason) {
  appendRow(SHEETS.IMPORT_FILE_LOG, {
    'File Hash': hash, 'File Name': fileName, 'Import Type': importType,
    'Uploaded On': new Date(), 'Uploaded By': actor, 'Data Till': '',
    'Processed': 0, 'Skipped': 0, 'Updated': 0, 'Reversed': 0,
    'Status': 'Rejected', 'Error': reason
  }, actor);
  throw new Error(reason);
}

/**
 * Per import type: how current the data is and when it was last uploaded.
 * "Data till" is the latest across ALL successful uploads, so uploading an
 * older file after a newer one never makes the data look older than it is.
 */
function getImportStatus(token) {
  return safeRun('getImportStatus', function () {
    requireRole_(token, PERMISSIONS.Import.view);
    var log = getAllRows(SHEETS.IMPORT_FILE_LOG);
    return Object.keys(IMPORT_TYPES).map(function (type) {
      var ok = log.filter(function (r) { return r['Import Type'] === type && r.Status === 'Success'; });
      var till = null, last = null;
      ok.forEach(function (r) {
        var d = r['Data Till'] ? new Date(r['Data Till']) : null;
        if (d && (!till || d > till)) till = d;
        if (!last || new Date(r['Uploaded On']) > new Date(last['Uploaded On'])) last = r;
      });
      return {
        type: type, label: IMPORT_TYPES[type].label,
        required: IMPORT_TYPES[type].required,
        isSnapshot: !IMPORT_TYPES[type].dateColumn,
        dataTill: till ? till.toISOString() : '',
        lastUploadOn: last ? last['Uploaded On'] : '',
        lastUploadBy: last ? last['Uploaded By'] : '',
        lastFileName: last ? last['File Name'] : ''
      };
    });
  });
}

/** Recent uploads, newest first, including refused ones with their reason. */
function listImportUploads(token) {
  return safeRun('listImportUploads', function () {
    requireRole_(token, PERMISSIONS.Import.view);
    return getAllRows(SHEETS.IMPORT_FILE_LOG)
      .map(function (r) {
        var o = {};
        Object.keys(r).forEach(function (k) { if (k !== 'File Hash') o[k] = r[k]; });
        o.label = (IMPORT_TYPES[r['Import Type']] || {}).label || r['Import Type'];
        return o;
      })
      .sort(function (a, b) { return new Date(b['Uploaded On']) - new Date(a['Uploaded On']); })
      .slice(0, 100);
  });
}

// ================================================================ PARSING =
/**
 * DMS exports come in two shapes: UTF-16 tab-separated (Vehicle sale,
 * Inter-dealer, Stock — despite the .csv name) and UTF-8 comma-separated
 * (the Sales Tax Report). Both are detected from the bytes rather than
 * trusting the file type picked, so a mis-picked type fails on its columns
 * with a useful message instead of decoding into garbage.
 */
function parseUploadedCsv_(bytes) {
  var b0 = bytes.length > 0 ? (bytes[0] & 0xFF) : -1;
  var b1 = bytes.length > 1 ? (bytes[1] & 0xFF) : -1;
  var blob = Utilities.newBlob(bytes);
  var text;
  if (b0 === 0xFF && b1 === 0xFE) text = blob.getDataAsString('UTF-16LE');
  else if (b0 === 0xFE && b1 === 0xFF) text = blob.getDataAsString('UTF-16BE');
  else {
    text = blob.getDataAsString('UTF-8');
    // UTF-16 without a byte-order mark shows up as text full of NUL characters.
    var nuls = (text.slice(0, 2000).match(/\u0000/g) || []).length;
    if (nuls > 200) text = blob.getDataAsString('UTF-16LE');
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);

  var firstLine = text.split(/\r?\n/, 1)[0] || '';
  var delim = firstLine.indexOf('\t') !== -1 ? '\t' : ',';
  return rowsToObjects_(Utilities.parseCsv(text, delim));
}

function headerKey_(h) {
  return String(h || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Re-keys every row so the importers can rely on one exact spelling of each
 * column ('Account GSTIN', single space), whatever the file actually used.
 * Original keys are kept alongside, so nothing an importer reads is lost.
 */
function canonicalizeHeaders_(rows, spec) {
  var found = Object.keys(rows[0]);
  var byKey = {};
  found.forEach(function (h) { byKey[headerKey_(h)] = h; });
  var missing = spec.required.filter(function (c) { return byKey[headerKey_(c)] === undefined; });
  if (missing.length) return { rows: [], missing: missing, found: found };

  var wanted = spec.required.concat(spec.optional || []);
  return {
    missing: [], found: found,
    rows: rows.map(function (r) {
      var o = {};
      Object.keys(r).forEach(function (k) { o[k] = r[k]; });
      wanted.forEach(function (c) {
        var src = byKey[headerKey_(c)];
        if (src !== undefined) o[c] = r[src];
      });
      return o;
    })
  };
}

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { var v = (b & 0xFF).toString(16); return v.length === 1 ? '0' + v : v; })
    .join('');
}

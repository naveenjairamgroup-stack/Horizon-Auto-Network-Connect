/**
 * SheetHelper.gs
 * Generic CRUD wrapper so business-logic files never touch raw
 * getRange()/getValues() directly. Every write also calls AuditLogService,
 * so audit logging is automatic rather than something each module must remember.
 *
 * Per-execution read cache: Apps Script gives every single web-app request
 * (every doPost/doGet call) its own fresh execution context — plain top-level
 * `var`s here do NOT persist between separate requests. That makes _sheetCache_
 * safe to keep as a simple object: it starts empty on every request and is
 * shared by every function called during THAT one request, so if the same tab
 * gets read multiple times in one request (e.g. the Stock import looking up
 * All_Model_Price_List once per vehicle, or Dealer_Master read at both the
 * start and end of an import), it's fetched from Sheets exactly once instead
 * of once per lookup — with zero risk of one request ever seeing another's
 * stale data. Any write path that isn't appendRow/updateRowWhere (batch
 * appends, direct row deletion) must call invalidateSheetCache_() itself so a
 * later read in the same request sees the fresh data — see appendRows() below
 * and deleteRowsWhere_() in InterDealerSaleImport.gs.
 */

var _sheetCache_ = {};

function getSheet_(tabName) {
  var sheet = getSpreadsheet().getSheetByName(tabName);
  if (!sheet) {
    throw new Error('Sheet not found: ' + tabName + '. Did you run setupDatabase()?');
  }
  return sheet;
}

function getHeaders_(tabName) {
  var headers = SHEET_HEADERS[tabName];
  if (!headers) {
    throw new Error('No header definition for tab "' + tabName + '" in Config.gs SHEET_HEADERS — check spelling.');
  }
  return headers;
}

/** Reads every data row of a tab as an array of plain objects keyed by header. Cached per-request — see file header comment. */
function getAllRows(tabName) {
  if (_sheetCache_[tabName]) return _sheetCache_[tabName];

  var sheet = getSheet_(tabName);
  var lastRow = sheet.getLastRow();
  var headers = getHeaders_(tabName);
  var rows;
  if (lastRow < 2) {
    rows = [];
  } else {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    rows = values.map(function (row, i) {
      var obj = {};
      headers.forEach(function (h, c) {
        var v = row[c];
        // Dates must be converted to strings here - google.script.run can silently
        // fail to deliver arrays of objects that contain raw Date values to the
        // client (returns null), leaving the success handler with no usable data.
        // Use duck-typing instead of instanceof - some Date values coming back from
        // Sheets fail an instanceof check (a realm/prototype quirk) despite behaving
        // like real Date objects, so instanceof alone let some of them slip through.
        var looksLikeDate = v && typeof v === 'object' && typeof v.getTime === 'function' && typeof v.toISOString === 'function';
        obj[h] = looksLikeDate ? v.toISOString() : v;
      });
      obj._row = i + 2; // 1-based sheet row number
      return obj;
    });
  }
  _sheetCache_[tabName] = rows;
  return rows;
}

/** Call after any write that bypasses appendRow()/updateRowWhere() (which already do this themselves), so the next read in this same execution isn't served stale cached data. */
function invalidateSheetCache_(tabName) {
  delete _sheetCache_[tabName];
}

/** Appends one row. rowObject keys must match the tab's headers (missing keys become ''). */
function appendRow(tabName, rowObject, actor) {
  var sheet = getSheet_(tabName);
  var headers = getHeaders_(tabName);
  var row = headers.map(function (h) { return rowObject[h] !== undefined ? rowObject[h] : ''; });
  sheet.appendRow(row);
  invalidateSheetCache_(tabName);
  logAction(actor || 'System', 'CREATE ' + tabName, '', JSON.stringify(rowObject));
  return row;
}

/**
 * Appends many rows in a single Sheets API call instead of one appendRow()
 * round-trip per row — the difference between one API call and 300+ for a
 * big Stock import, for example. Each object's keys must match the tab's
 * headers (missing keys become ''). No-ops cleanly on an empty array.
 */
function appendRows(tabName, rowObjects, actor) {
  if (!rowObjects || rowObjects.length === 0) return;
  var sheet = getSheet_(tabName);
  var headers = getHeaders_(tabName);
  var values = rowObjects.map(function (rowObject) {
    return headers.map(function (h) { return rowObject[h] !== undefined ? rowObject[h] : ''; });
  });
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
  invalidateSheetCache_(tabName);
  logAction(actor || 'System', 'BULK CREATE ' + tabName, '', values.length + ' rows');
}

/** Updates specific columns on the row where idColumn === idValue. Returns true if found. */
function updateRowWhere(tabName, idColumn, idValue, updates, actor) {
  var sheet = getSheet_(tabName);
  var headers = getHeaders_(tabName);
  var idIndex = headers.indexOf(idColumn);
  if (idIndex === -1) throw new Error('Unknown column ' + idColumn + ' in ' + tabName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(idValue)) {
      var oldValue = JSON.stringify(values[i]);
      Object.keys(updates).forEach(function (key) {
        var colIndex = headers.indexOf(key);
        if (colIndex !== -1) {
          sheet.getRange(i + 2, colIndex + 1).setValue(updates[key]);
        }
      });
      invalidateSheetCache_(tabName);
      logAction(actor || 'System', 'UPDATE ' + tabName + ' (' + idColumn + '=' + idValue + ')', oldValue, JSON.stringify(updates));
      return true;
    }
  }
  return false;
}

/** Finds a single row where idColumn === idValue, or null. */
function findRow(tabName, idColumn, idValue) {
  var rows = getAllRows(tabName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idColumn]) === String(idValue)) return rows[i];
  }
  return null;
}

/** Finds all rows matching a simple equality filter object, e.g. {Role:'Dealer'}. */
function findRows(tabName, filter) {
  return getAllRows(tabName).filter(function (row) {
    return Object.keys(filter).every(function (k) { return String(row[k]) === String(filter[k]); });
  });
}

/**
 * SheetHelper.gs
 * Generic CRUD wrapper so business-logic files never touch raw
 * getRange()/getValues() directly. Every write also calls AuditLogService,
 * so audit logging is automatic rather than something each module must remember.
 */

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

/** Reads every data row of a tab as an array of plain objects keyed by header. */
function getAllRows(tabName) {
  var sheet = getSheet_(tabName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = getHeaders_(tabName);
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row, i) {
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

/** Appends one row. rowObject keys must match the tab's headers (missing keys become ''). */
function appendRow(tabName, rowObject, actor) {
  var sheet = getSheet_(tabName);
  var headers = getHeaders_(tabName);
  var row = headers.map(function (h) { return rowObject[h] !== undefined ? rowObject[h] : ''; });
  sheet.appendRow(row);
  logAction(actor || 'System', 'CREATE ' + tabName, '', JSON.stringify(rowObject));
  return row;
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

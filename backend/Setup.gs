/**
 * Setup.gs
 * Run these functions ONCE from the Apps Script editor (Select function
 * dropdown in the toolbar → pick the function → Run). Safe to re-run —
 * it never deletes existing data, only fills in what's missing.
 */

/**
 * STEP 1 — run this to build the database. If you opened Apps Script from
 * inside your Google Sheet (Extensions > Apps Script), no spreadsheet ID
 * setup is needed — see Config.gs for the standalone-project alternative.
 * Creates every tab with its header row if it doesn't already exist,
 * MIGRATES existing tabs if new columns were added to SHEET_HEADERS since
 * you last ran this (safe — only appends missing columns, never touches
 * existing data), seeds the Voucher Head Master with real-world heads,
 * and creates one default Admin login so you can sign in for the first time.
 */
function setupDatabase() {
  var ss = getSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    var headers = SHEET_HEADERS[tabName];
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      return;
    }
    var lastCol = sheet.getLastColumn();
    var existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var isBlank = existingHeaders.length === 0 || existingHeaders.every(function (v) { return v === ''; });
    if (isBlank) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    } else {
      migrateSheetHeaders_(sheet, existingHeaders, headers);
    }
  });

  // Remove the default blank "Sheet1" Apps Script creates with a brand-new spreadsheet.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  seedVoucherHeads_();
  seedFirstAdmin_();
  Logger.log('Database setup complete.');
}

/**
 * Appends any header in `wanted` that isn't already in `existingHeaders` to
 * the END of the sheet — never reorders or removes existing columns, so
 * existing data (and existing row objects returned by getAllRows) are
 * completely unaffected. Called automatically by setupDatabase() — safe
 * to re-run any time you add a new column to SHEET_HEADERS in Config.gs.
 */
function migrateSheetHeaders_(sheet, existingHeaders, wanted) {
  var toAdd = wanted.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
  if (toAdd.length === 0) return;
  var startCol = existingHeaders.length + 1;
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
  Logger.log('Migrated "' + sheet.getName() + '": added column(s) ' + toAdd.join(', '));
}

/**
 * Seeds Voucher_Head_Master with the real transaction heads found while
 * analysing sample dealer ledgers, each tagged with its correct effect on
 * Outstanding (see architecture doc, section 9). Admin can add more later
 * from the UI — this just seeds sensible starting data, nothing is hardcoded
 * into the business logic itself.
 */
function seedVoucherHeads_() {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.VOUCHER_HEAD_MASTER);
  if (sheet.getLastRow() > 1) return; // already seeded
  var rows = [
    ['Vehicle Sale',               'Sales',    EFFECT.INCREASE, true,  true],
    ['Parts Sale',                 'Sales',    EFFECT.INCREASE, true,  true],
    ['Business Support Services',  'Sales',    EFFECT.INCREASE, true,  true],
    ['Vehicle Purchase / Return',  'Purchase', EFFECT.DECREASE, true,  true],
    ['Parts Purchase / Return',    'Purchase', EFFECT.DECREASE, true,  true],
    ['Commission',                 'Purchase', EFFECT.DECREASE, true,  true],
    ['Network FSC',                'Purchase', EFFECT.DECREASE, true,  true],
    ['Finance Company Advance',    'Journal',  EFFECT.DECREASE, false, true],
    ['Payment Received',           'Receipt',  EFFECT.DECREASE, false, true],
    ['Debit Note',                 'Journal',  EFFECT.INCREASE, false, true],
    ['Credit Note',                'Journal',  EFFECT.DECREASE, false, true],
    ['Opening Balance Adjustment', 'Journal',  EFFECT.INCREASE, false, true]
  ];
  rows.forEach(function (r) { sheet.appendRow(r); });
}

/**
 * Creates a single default Admin login (username: admin) so you can log in
 * the first time and create everyone else through the User Master screen.
 * CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN (Change Password screen).
 */
function seedFirstAdmin_() {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.USER_MASTER);
  if (sheet.getLastRow() > 1) return; // a user already exists
  var salt = Utilities.getUuid();
  var hash = hashPassword_('Admin@123', salt);
  sheet.appendRow(['admin', hash, salt, ROLES.ADMIN, '', 'System Administrator', true, '', new Date(), 'System']);
  Logger.log('Default admin created — username: admin / password: Admin@123 — CHANGE THIS immediately.');
}

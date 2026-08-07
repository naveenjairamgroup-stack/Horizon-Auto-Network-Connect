/**
 * Config.gs
 * Single source of truth for every constant used across the system.
 * NOTHING should be hardcoded anywhere else in the codebase — always
 * reference these constants or the Config sheet tab.
 */

// ---- Spreadsheet ------------------------------------------------------------
// Easiest setup: open Apps Script from INSIDE your Google Sheet
// (Extensions > Apps Script) — then the script is "bound" to that sheet and
// getActiveSpreadsheet() below finds it automatically, no ID needed.
//
// Only if you instead created a standalone Apps Script project (from
// script.google.com directly, not from inside a Sheet), run this once:
//   setSpreadsheetId_('YOUR_SHEET_ID_HERE')   // ID is the long code in the
//                                              // sheet's URL between /d/ and /edit
function setSpreadsheetId_(id) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  Logger.log('Spreadsheet ID saved: ' + id);
}

function getSpreadsheet() {
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('No bound spreadsheet found and no SPREADSHEET_ID set. See Config.gs comments above.');
  }
  return SpreadsheetApp.openById(id);
}

// ---- Sheet / tab names --------------------------------------------------
var SHEETS = {
  DEALER_MASTER:       'Dealer_Master',
  USER_MASTER:         'User_Master',
  COMMISSION_MASTER:   'Commission_Master',
  CREDIT_LIMIT_MASTER: 'Credit_Limit_Master',
  OPENING_BALANCE:     'Opening_Balance',
  VOUCHER_HEAD_MASTER: 'Voucher_Head_Master',
  LEDGER_TRANSACTIONS: 'Ledger_Transactions',
  PAYMENT_ENTRIES:     'Payment_Entries',
  RETURN_ENTRIES:      'Return_Entries',
  COMMISSION_ENTRIES:  'Commission_Entries',
  IMPORT_LOG:          'Import_Log',
  AUDIT_LOG:           'Audit_Log',
  NOTIFICATION_LOG:    'Notification_Log',
  LOGIN_HISTORY:       'Login_History',
  MONTH_CLOSING_LOG:   'Month_Closing_Log',
  ERROR_LOG:           'Error_Log',
  VEHICLE_SALE_DETAIL:        'Vehicle_Sale_Detail',
  VEHICLE_SALE_REVIEW_QUEUE:  'Vehicle_Sale_Review_Queue',
  PARTS_SALE_DETAIL:          'Parts_Sale_Detail',
  PARTS_SALE_REVIEW_QUEUE:    'Parts_Sale_Review_Queue',
  ALL_MODEL_PRICE_LIST:       'All_Model_Price_List',
  INVENTORY_DETAIL:           'Inventory_Detail'
};

// Header rows for every sheet. Setup.gs uses this to create tabs; SheetHelper.gs
// uses it to read/write rows as plain objects instead of raw arrays/indices.
// Tabs beyond Phase 1 (Payment_Entries, Return_Entries, Commission_*, etc.) are
// created now too so the schema never needs to change again in Phase 2/3.
var SHEET_HEADERS = {
  Dealer_Master:       ['Dealer Code','Dealer Name','Type','Address','GST','PAN','Contact Person','Mobile','Email','Credit Limit','Security Deposit','Region','Network Manager','Status','Created On','Created By','Vehicle Sale Alias','Inventory Location Alias'],
  User_Master:         ['Username','Password Hash','Salt','Role','Dealer Code','Full Name','Active','Last Login','Created On','Created By'],
  Commission_Master:   ['Vehicle Model','Commission Type','Rate','Effective Date','Created By'],
  Credit_Limit_Master: ['Dealer Code','Approved Limit','Temporary Limit','Validity','Approval Authority','Updated On'],
  Opening_Balance:     ['Dealer Code','Financial Year','Amount','Balance Type','Set By','Set On','Effective Date'],
  Voucher_Head_Master: ['Head Name','Vch Type','Effect','GST Applicable','Active'],
  Ledger_Transactions: ['Entry ID','Date','Invoice No','Head','Dealer Code','Debit','Credit','Running Balance','Remarks','Created By','Timestamp','Invoice Date'],
  Payment_Entries:     ['Payment ID','Dealer Code','Mode','Amount','Reference No','Date','Submitted By','Submitted Role','Approval Status','Approved By','Approved On','Posted To Ledger','Remarks'],
  Return_Entries:      ['Return ID','Dealer Code','Return Type','Invoice No','Invoice Date','Frame Numbers','Part Description','Total Amount','Attachment Link','Submitted By','Submitted Role','Approval Status','Approved By','Approved On','Posted To Ledger','Late Entry'],
  Commission_Entries:  ['Entry ID','Dealer Code','Month','Model','Retail Count','Amount','Created On'],
  Import_Log:          ['File Name','Upload Time','Records Processed','Duplicates Skipped','Status','Folder Type','Updated Count','Reversed Count'],
  Audit_Log:           ['Timestamp','User','Action','Old Value','New Value'],
  Notification_Log:    ['Dealer Code','Type','Message','Timestamp','Read Status'],
  Login_History:       ['Username','Login Time','Logout Time','Device','IP'],
  Month_Closing_Log:   ['Month','Financial Year','Closed By','Closed On','Closing Balance'],
  Error_Log:           ['Timestamp','Context','Message','Stack'],

  // ---- Drive import feature (Vehicle Sale / Parts / Inter-Dealer) ----
  Vehicle_Sale_Detail: ['Detail ID','Invoice No','Dealer Code','Source','Frame No','Model Name','Model Variant','Color','Taxable Value','Tax Amount','Frame Total Amount','Customer Name','Created On'],
  Vehicle_Sale_Review_Queue: ['Queue ID','Invoice No','Dealer Code','Customer Name','Frame Numbers','Model Info','Total Invoice Amount','Purchase Type','Financier','Hypothecation','Finance Amount','Registration Type','Registration Amount','Insurance Type','Insurance Amount','EW Type','EW Amount','HPA Amount','Status','Submitted By','Submitted On','Invoice Date'],
  Parts_Sale_Detail:   ['Detail ID','Invoice No','Dealer Code','Order Type','Customer Name','Part Description','Part Number','HSN Code','Qty','Taxable Amount','Total Tax','Final Amount','Created On'],
  Parts_Sale_Review_Queue: ['Queue ID','Invoice No','Invoice Date','Account Name','Account GSTIN','Order Type','Total Invoice Value','Suggested Dealer Code','Status','Assigned Dealer Code','Assigned By','Assigned On'],

  // ---- Stock / Inventory valuation feature -------------------------------
  All_Model_Price_List: ['Model Category','Model Variant','Ex-Showroom Price','Updated On'],
  Inventory_Detail: ['Detail ID','Dealer Code','Frame No','Model Variant','Color','Ex-Showroom Value','Created On']
};

// ---- Roles ---------------------------------------------------------------
var ROLES = {
  ADMIN: 'Admin',
  NETWORK_MANAGER: 'Network Manager',
  ACCOUNTS: 'Accounts',
  DEALER: 'Dealer'   // covers AD / ASC / FO logins; row-level scoping is by Dealer Code
};

// ---- Dealer / network types -------------------------------------------
var DEALER_TYPES = {
  AD: 'AD',    // Associate Dealer — direct billing rights
  ASC: 'ASC',  // Authorised Service Centre — billed through main dealership
  FO: 'FO'     // Festival Outlet — billed through main dealership
};

// ---- Approval status -------------------------------------------------------
var APPROVAL_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected'
};

// ---- Ledger effect (drives Outstanding math — see OutstandingService.gs) ----
var EFFECT = {
  INCREASE: 'Increase',   // posts as Debit — adds to what the dealer owes Honda
  DECREASE: 'Decrease'    // posts as Credit — reduces what the dealer owes Honda
};

// ---- Session ----------------------------------------------------------------
var SESSION_TIMEOUT_MINUTES = 30;

// ---- Back-dated entry rule (Returns, Phase 2) --------------------------
var RETURN_BACKDATE_LIMIT_DAYS = 7;

// ---- Drive import feature -----------------------------------------------
var IMPORT_SUBFOLDERS = {
  VEHICLE_SALE: 'Vehicle_Sale',   // ASC-billed vehicles (matched via Dealer Master's "Vehicle Sale Alias")
  PARTS:        'Parts',          // Sales Tax Report (parts/labour, Main Dealer network type only)
  INTER_DEALER: 'Inter_Dealer',   // AD-billed vehicles (direct billing rights)
  STOCK:        'Stock'           // Physical stock/inventory report (matched via "Inventory Location Alias")
};
var PARTS_CANCEL_MATCH_THRESHOLD = 0.95; // see PartsSaleImport.gs — only auto-reverse a "missing" invoice if 95%+ of previously-imported invoices in that date range still match
var VEHICLE_SALE_EDIT_WINDOW_MINUTES = 60; // Network Manager can self-edit a submitted review for 1 hour, then only Admin/Accounts
var STOCK_COUNTABLE_PHYSICAL_STATUSES = { 'Received-OK': true, 'In-Transit': true }; // only these count as "sitting inventory" — others (e.g. Damaged) are ignored

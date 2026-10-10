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
  INVENTORY_DETAIL:           'Inventory_Detail',

  // ---- Network commission feature (ASC vehicle commission) ----------------
  // Deliberately NEW tab names rather than reusing the old Commission_Master /
  // Commission_Entries: those two belong to the previous (unused) commission
  // engine, and renaming in place would make setupDatabase() append the new
  // columns onto the old header row. Leaving them untouched means zero risk to
  // anything already sitting in the sheet.
  COMMISSION_RATE_MASTER:     'Commission_Rate_Master',
  COMMISSION_CONFIG:          'Commission_Config',
  COMMISSION_REPORT:          'Commission_Report',
  COMMISSION_REPORT_LINE:     'Commission_Report_Line',

  // One row per file uploaded through the portal. The SHA-256 of the file is
  // what blocks the same export being imported twice.
  IMPORT_FILE_LOG:            'Import_File_Log',

  // Plain key/value settings Admin can change from the UI (mail recipients
  // and the like). Anything not set here falls back to the constant of the
  // same purpose in this file.
  APP_SETTINGS:               'App_Settings'
};

// Header rows for every sheet. Setup.gs uses this to create tabs; SheetHelper.gs
// uses it to read/write rows as plain objects instead of raw arrays/indices.
// Tabs beyond Phase 1 (Payment_Entries, Return_Entries, Commission_*, etc.) are
// created now too so the schema never needs to change again in Phase 2/3.
var SHEET_HEADERS = {
  Dealer_Master:       ['Dealer Code','Dealer Name','Type','Address','GST','PAN','Contact Person','Mobile','Email','Credit Limit','Security Deposit','Region','Network Manager','Status','Created On','Created By','Vehicle Sale Alias','Inventory Location Alias','Pin Code'],
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
  Parts_Sale_Detail:   ['Detail ID','Invoice No','Dealer Code','Order Type','Customer Name','Part Description','Part Number','HSN Code','Qty','Taxable Amount','Total Tax','Final Amount','Created On','Invoice Date'],
  Parts_Sale_Review_Queue: ['Queue ID','Invoice No','Invoice Date','Account Name','Account GSTIN','Order Type','Total Invoice Value','Suggested Dealer Code','Status','Assigned Dealer Code','Assigned By','Assigned On'],

  // ---- Stock / Inventory valuation feature -------------------------------
  All_Model_Price_List: ['Model Category','Model Variant','Ex-Showroom Price','Updated On'],
  Inventory_Detail: ['Detail ID','Dealer Code','Frame No','Model Variant','Color','Ex-Showroom Value','Created On'],

  // ---- Network commission feature ----------------------------------------
  // Rates are append-only: editing a variant's rate writes a NEW row with a new
  // "Effective From", so the old rate stays readable as history. The rate that
  // applies is always the newest row whose Effective From has already passed.
  Commission_Rate_Master: ['Model Variant','Commission Amount','Effective From','Created On','Created By'],
  // Same append-only idea, for the non-per-model numbers (registration flat
  // amount, insurance %, GST %). "Scope" blank = applies to every dealer; a
  // Dealer Code in Scope overrides the blank one for that dealer only.
  Commission_Config: ['Config Key','Scope','Value','Effective From','Created On','Created By'],
  Commission_Report: [
    'Report ID','Dealer Code','Month','Status','Frame Count',
    'Vehicle Com','Reg Com','Ins Com','Taxable','SGST','CGST','Invoice Amount',
    'Generated On','Generated By',
    'Invoice Requested On','Invoice Requested By',
    'ASC Invoice No','ASC Invoice Date','ASC Invoice Amount','Attachment Link','Uploaded On','Uploaded By',
    'Tally Entry Date','Verified By','Verified On','Ledger Entry ID','Remarks',
    'Email Sent On','Email Recipients','Email Thread ID'
  ],
  Import_File_Log: ['File Hash','File Name','Import Type','Uploaded On','Uploaded By','Data Till',
    'Processed','Skipped','Updated','Reversed','Status','Error'],
  App_Settings: ['Key','Value','Updated On','Updated By'],
  Commission_Report_Line: [
    'Line ID','Report ID','Dealer Code','Month','Invoice No','Invoice Date','Frame No',
    'Model Variant','Customer Name','Vehicle Com','Registration Type','Registration Amount',
    'Reg Com','Insurance Amount','Ins Rate %','Ins Com','Line Total','Created On'
  ]
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

// ---- Network commission feature -----------------------------------------
/**
 * The lifecycle of one ASC's commission for one month. Movement is strictly
 * forward; the only backwards step is regenerating, which is allowed ONLY
 * while still in GENERATED (see generateCommissionReport).
 */
var COMMISSION_STATUS = {
  GENERATED:        'Generated',          // figures calculated, under review by NM/Accounts/Admin
  INVOICE_REQUESTED:'Invoice Requested',  // ASC has been asked to raise a tax invoice — now visible to the ASC
  INVOICE_UPLOADED: 'Invoice Uploaded',   // ASC uploaded its tax invoice, waiting for Accounts/Admin to verify
  POSTED:           'Posted'              // verified + written to the ledger — permanently locked
};

/** Config keys stored in Commission_Config. Values are editable from the UI (Admin only), never hardcoded in the calculation. */
var COMMISSION_CONFIG_KEYS = {
  REGISTRATION_COMMISSION:  'REGISTRATION_COMMISSION',  // flat amount, only when Registration Type is Permanent Registration
  INSURANCE_COMMISSION_PCT: 'INSURANCE_COMMISSION_PCT', // % of the GST-exclusive insurance base; can be overridden per dealer
  SGST_PCT:                 'SGST_PCT',
  CGST_PCT:                 'CGST_PCT'
};

// Insurance premium is GST-inclusive in the source report; the commission is
// calculated on the base, so the premium is divided by this first.
var INSURANCE_GST_DIVISOR = 1.18;

// Only Registration Type exactly equal to this earns the flat registration commission.
var COMMISSION_REGISTRATION_TYPE = 'Permanent Registration';

// Ledger head used when a verified commission invoice is posted. Must exist in Voucher_Head_Master.
var COMMISSION_LEDGER_HEAD = 'Commission';

// How long one PIN entry keeps rate editing unlocked, in minutes.
var COMMISSION_PIN_UNLOCK_MINUTES = 10;

/**
 * Our own details, as they must appear in the "Billed To" block of the tax
 * invoice the ASC raises on us. Kept here rather than in the sheet because
 * these change roughly never, and a typo in a GSTIN on an outgoing tax
 * document is worth guarding behind a code change.
 */
var COMPANY = {
  name:         'HORIZON AUTO',
  addressLine1: 'BESIDE RASHTRIYA NAVIN MAIL, REDMA,',
  addressLine2: 'RANCHI ROAD MEDININAGAR JHARKHAND',
  pinCode:      '822101',
  gstin:        '20AAMFH4746A1ZU',
  pan:          'AAMFH4746A',
  cin:          '',
  tele:         '9534541101',
  state:        'Jharkhand',
  stateCode:    '20'
};

// Service accounting code printed on the commission invoice.
var COMMISSION_SAC = '996211';

// Every ASC is in Jharkhand, so supply is always intra-state: CGST + SGST,
// never IGST. Used for the dealer's own state block on the invoice when
// Dealer_Master has nothing more specific.
var COMMISSION_DEFAULT_STATE = 'Jharkhand';
var COMMISSION_DEFAULT_STATE_CODE = '20';

// Display name the ASC sees in their inbox. The underlying address stays
// whichever Google account owns this Apps Script project and cannot be
// hidden — most mail clients reveal it on tap.
var COMMISSION_EMAIL_SENDER_NAME = 'Horizon Auto Network Connect';

// Copied on every commission invoice request, and also used as Reply-To so a
// plain "Reply" from the ASC reaches all three desks rather than landing in
// the script owner's mailbox alone.
var COMMISSION_EMAIL_CC = [
  'accounts@horizonhonda.in',
  'finance@horizonhonda.in',
  'sales@horizonauto.in'
];

// Blank space left at the top and bottom of the commission invoice for the
// ASC's own pre-printed letterhead. Used for the PDF and as the starting
// value in the print window, where it can still be nudged before printing.
var COMMISSION_LETTERHEAD_TOP_MM = 55;
var COMMISSION_LETTERHEAD_BOTTOM_MM = 35;

// Linked from the email's call-to-action button.
var COMMISSION_PORTAL_URL = 'https://horizon-auto-network-connect.pages.dev';


// ---- Portal file import --------------------------------------------------
/**
 * What each upload type needs. "required" columns must be present (matched
 * ignoring case and extra spaces, in any order) or the whole file is
 * rejected with the missing names listed — a missing column used to mean
 * silently blank values, not an error. "dateColumn" is what "data till"
 * is read from; Stock has none, so its as-of date is the upload date.
 */
var IMPORT_TYPES = {
  INTER_DEALER: {
    label: 'Inter-dealer sale (AD)',
    logFolder: 'Inter_Dealer',
    required: ['Invoice Number', 'Status', 'Requesting Network Code', 'Invoice Date', 'Frame #', 'Model Variant', 'Total Amount'],
    optional: ['Color', 'Customer Name', 'Customer First Name', 'Customer Middle Name', 'Customer Last Name',
               'Dealer Billing Price', 'Model Category', 'Taxable Value'],
    dateColumn: 'Invoice Date'
  },
  VEHICLE_SALE: {
    label: 'Vehicle sale (ASC)',
    logFolder: 'Vehicle_Sale',
    required: ['Invoice #', 'Status', 'Assigned To (DSE) Name', 'Invoice Date', 'Frame #', 'Model Variant', 'Total Invoice Amount'],
    optional: ['Model Name', 'Color', 'Customer Name', 'Purchase Type', 'Financier', 'Hypothecation', 'Finance Amount'],
    dateColumn: 'Invoice Date'
  },
  PARTS: {
    label: 'Parts sale',
    logFolder: 'Parts',
    required: ['Invoice Number', 'Invoice Date', 'Network Type', 'Account GSTIN', 'Account Name', 'Final Line Item Invoice Amt'],
    optional: ['Order Type', 'Customer Name', 'Part / Labour Description', 'Part / Labour Number', 'HSN / SAC Code',
               'QTY Shipped', 'Taxable Amount', 'Total Tax'],
    dateColumn: 'Invoice Date'
  },
  STOCK: {
    label: 'Vehicle stock',
    logFolder: 'Stock',
    required: ['Inventory Location', 'Physical Status', 'Frame #', 'Model Variant'],
    optional: ['Color'],
    dateColumn: null
  }
};

// Apps Script has a hard 6-minute limit per request. Files this big are
// refused up front with a clear message instead of failing half-way.
var IMPORT_MAX_BYTES = 8 * 1024 * 1024;

// ---- Ledger --------------------------------------------------------------
// Heads allowed in Bulk ledger entry, and which side each one posts to.
var BULK_ENTRY_HEADS = {
  'Interest':   'Debit',   // charged to the dealer
  'Commission': 'Credit'   // paid to the dealer
};

// A payment matching an earlier one on dealer, amount, date and reference
// asks for confirmation instead of being added silently.
var PAYMENT_DUPLICATE_STATUSES = { 'Pending': true, 'Approved': true };

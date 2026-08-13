/**
 * InterDealerSaleImport.gs
 * Vehicles billed directly by AD (Associate Dealer) partners — Inter_Dealer_Sale
 * export. Rules (confirmed in chat):
 *   - Only rows where Status = 'New' are considered; 'Cancelled' rows reverse
 *     an already-posted invoice.
 *   - Group by Invoice Number (one invoice can carry several Frame Numbers) —
 *     one combined Ledger Debit per invoice, Head = 'Vehicle Sale'.
 *   - Requesting Network Code matches Dealer_Master's Dealer Code directly
 *     (no fuzzy matching needed here — it's already a code).
 *   - Frame-level detail (Model/Color/Taxable Value/Tax/Amount) is stored in
 *     Vehicle_Sale_Detail (Source = 'AD') so the ledger popup can show it.
 */

function runInterDealerSaleImport_(actor) {
  var files = listFilesInFolder_(IMPORT_SUBFOLDERS.INTER_DEALER);
  var processed = 0, skipped = 0, updated = 0, reversed = 0;

  files.forEach(function (file) {
    var rows = readTsvUtf16File_(file);
    var grouped = groupBy_(rows, 'Invoice Number');

    grouped.order.forEach(function (invoiceNo) {
      var frames = grouped.groups[invoiceNo];
      var result = processInterDealerInvoice_(invoiceNo, frames);
      if (result === 'processed') processed++;
      else if (result === 'skipped') skipped++;
      else if (result === 'updated') updated++;
      else if (result === 'reversed') reversed++;
    });

    logImportRun_(file.getName(), 'Inter_Dealer', processed, skipped, updated, reversed, 'Success');
  });

  return { folder: 'Inter_Dealer', files: files.length, processed: processed, skipped: skipped, updated: updated, reversed: reversed };
}

function processInterDealerInvoice_(invoiceNo, frames) {
  var first = frames[0];
  var dealerCode = first['Requesting Network Code'];
  var dealer = findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode);
  if (!dealer) return 'skipped'; // unknown dealer code — nothing we can safely do

  var allCancelled = frames.every(function (f) { return f.Status === 'Cancelled'; });
  var allNew = frames.every(function (f) { return f.Status === 'New'; });

  var existingDetail = findRows(SHEETS.VEHICLE_SALE_DETAIL, { 'Invoice No': invoiceNo, 'Source': 'AD' });
  var alreadyImported = existingDetail.length > 0;

  if (allCancelled) {
    if (!alreadyImported) return 'skipped'; // was never imported (e.g. cancelled same day it was booked) — nothing to reverse
    var oldTotal = existingDetail.reduce(function (s, d) { return s + parseAmount_(d['Frame Total Amount']); }, 0);
    reverseLedgerEntry_('Vehicle Sale', dealerCode, invoiceNo, oldTotal, true, 'Reversed — Inter Dealer Sale invoice ' + invoiceNo + ' shows Cancelled');
    return 'reversed';
  }

  if (!allNew) return 'skipped'; // mixed/unexpected status within one invoice — needs a human look, don't guess

  var newTotal = frames.reduce(function (s, f) { return s + parseAmount_(f['Total Amount']); }, 0);

  if (!alreadyImported) {
    postVehicleSaleLedgerEntry_(dealerCode, invoiceNo, newTotal, 'Vehicle Sale — Inter Dealer (AD)', first['Invoice Date']);
    frames.forEach(function (f) { appendVehicleSaleDetailRow_(invoiceNo, dealerCode, 'AD', f); });
    return 'processed';
  }

  var oldTotal2 = existingDetail.reduce(function (s, d) { return s + parseAmount_(d['Frame Total Amount']); }, 0);
  if (Math.abs(oldTotal2 - newTotal) < 0.01) return 'skipped'; // unchanged, already imported

  // Data changed since last import — reverse the old figure and post the corrected one, keeping full audit trail.
  reverseLedgerEntry_('Vehicle Sale', dealerCode, invoiceNo, oldTotal2, true, 'Reversed for re-import — Inter Dealer Sale invoice ' + invoiceNo + ' data changed');
  postVehicleSaleLedgerEntry_(dealerCode, invoiceNo, newTotal, 'Vehicle Sale — Inter Dealer (AD), corrected', first['Invoice Date']);
  deleteRowsWhere_(SHEETS.VEHICLE_SALE_DETAIL, existingDetail);
  frames.forEach(function (f) { appendVehicleSaleDetailRow_(invoiceNo, dealerCode, 'AD', f); });
  return 'updated';
}

/** Shared by both AD and ASC importers. date should be the raw Invoice Date value (string/Date) from the raw file. */
function postVehicleSaleLedgerEntry_(dealerCode, invoiceNo, amount, remarks, date) {
  var parsedDate = parseInvoiceDate_(date);
  appendRow(SHEETS.LEDGER_TRANSACTIONS, {
    'Entry ID': generateId('LED'),
    'Date': parsedDate,
    'Invoice No': invoiceNo,
    'Head': 'Vehicle Sale',
    'Dealer Code': dealerCode,
    'Debit': amount,
    'Credit': 0,
    'Running Balance': 0,
    'Remarks': remarks,
    'Created By': 'System (Import)',
    'Timestamp': new Date(),
    'Invoice Date': parsedDate
  }, 'System (Import)');
  recomputeRunningBalance_(dealerCode);
}

/** Shared by both AD and ASC importers — one row per Frame Number under an invoice. */
function appendVehicleSaleDetailRow_(invoiceNo, dealerCode, source, frameRow) {
  appendRow(SHEETS.VEHICLE_SALE_DETAIL, {
    'Detail ID': generateId('VSD'),
    'Invoice No': invoiceNo,
    'Dealer Code': dealerCode,
    'Source': source,
    'Frame No': frameRow['Frame #'] || '',
    'Model Name': frameRow['Model Category'] || '',
    'Model Variant': frameRow['Model Variant'] || '',
    'Color': frameRow['Color'] || '',
    'Taxable Value': parseAmount_(frameRow['Dealer Billing Price'] || frameRow['Taxable Value']),
    'Tax Amount': computeFrameTotalTax_(frameRow),
    'Frame Total Amount': parseAmount_(frameRow['Total Amount']),
    'Customer Name': frameRow['Customer Name'] || buildCustomerName_(frameRow),
    'Created On': new Date()
  }, 'System (Import)');
}

function computeFrameTotalTax_(f) {
  var fields = ['CGST Amount', 'SGST Amount', 'UTGST Amount', 'IGST Amount', 'CESS Amount'];
  return fields.reduce(function (sum, key) { return sum + parseAmount_(f[key]); }, 0);
}

function buildCustomerName_(f) {
  return [f['Customer First Name'], f['Customer Middle Name'], f['Customer Last Name']]
    .filter(function (p) { return p && String(p).trim(); })
    .join(' ');
}

/** Deletes a set of already-fetched rows (each must carry the internal _row property from getAllRows/findRows). */
function deleteRowsWhere_(tabName, rows) {
  var sheet = getSpreadsheet().getSheetByName(tabName);
  var rowNumbers = rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; }); // delete bottom-up
  rowNumbers.forEach(function (rn) { sheet.deleteRow(rn); });
  invalidateSheetCache_(tabName);
}

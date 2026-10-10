/**
 * PartsSaleImport.gs
 * Parts & labour sales — Sales Tax Report export. Rules confirmed in chat:
 *   - ONLY rows where Network Type = 'Main Dealer' are considered at all.
 *     ('Sub Dealer' / 'Third Party' rows are ignored outright — those
 *     dealers already bill directly, this report isn't their source.)
 *   - Within those Main Dealer rows, match to a network dealer by:
 *       1. Account GSTIN → Dealer_Master GST column (exact match) → post
 *          straight to that dealer's ledger.
 *       2. If no GST match, try the normalized Account Name → Dealer Name
 *          (exact match after stripping "M/S", punctuation, case) → goes to
 *          Parts_Sale_Review_Queue for Admin to confirm.
 *       3. If neither matches → skip (genuine Main Dealer / walk-in retail).
 *   - No Status column in this report, so cancellation is detected by DIFF:
 *     invoices that were previously imported for a date range but are now
 *     missing from a fresh file = cancelled, but ONLY auto-reversed if
 *     PARTS_CANCEL_MATCH_THRESHOLD (95%) or more of the previously-imported
 *     invoices in that range still match — otherwise this looks like a bad
 *     upload, so nothing is touched and it's logged for a human to check.
 *   - Group by Invoice Number (many part/labour lines can share one invoice)
 *     — one combined Ledger Debit per invoice, Head = 'Parts Sale'.
 */

function runPartsSaleImport_(actor) {
  var files = listFilesInFolder_(IMPORT_SUBFOLDERS.PARTS);
  var total = newCounts_();
  files.forEach(function (file) {
    var c = processPartsRows_(readCsvUtf8File_(file));
    logImportRun_(file.getName(), 'Parts', c.processed, c.skipped, c.updated, c.reversed, 'Success');
    addCounts_(total, c);
  });
  return { folder: 'Parts', files: files.length, processed: total.processed, skipped: total.skipped, updated: total.updated, reversed: total.reversed };
}

/** One file's rows, already parsed. Shared by the Drive importer and the portal upload. */
function processPartsRows_(allRows) {
  var c = newCounts_();
  var mainDealerRows = allRows.filter(function (r) {
    return r['Network  Type'] === 'Main Dealer' || r['Network Type'] === 'Main Dealer';
  });
  var grouped = groupBy_(mainDealerRows, 'Invoice Number');
  grouped.order.forEach(function (invoiceNo) {
    var result = processPartsInvoice_(invoiceNo, grouped.groups[invoiceNo]);
    if (result === 'review') c.skipped++; // routed to Parts review — counted as handled
    else if (c[result] !== undefined) c[result]++;
  });
  // Cancellation-by-diff, scoped to this file's own invoice date range.
  c.reversed += detectAndReverseMissingPartsInvoices_(mainDealerRows);
  return c;
}

function processPartsInvoice_(invoiceNo, lines) {
  // Once an invoice has ever gone to the review queue (Pending or Assigned), leave it
  // alone here — re-assignment happens only via assignPartsSaleReview(), never automatically,
  // so a dealer's GST being added later doesn't create duplicate detail rows.
  if (findRows(SHEETS.PARTS_SALE_REVIEW_QUEUE, { 'Invoice No': invoiceNo }).length > 0) return 'skipped';

  var first = lines[0];
  var gstMatch = findDealerByGst_(first['Account  GSTIN'] || first['Account GSTIN']);
  var dealer = gstMatch;

  if (!dealer) {
    var nameMatch = findDealerByName_(first['Account  Name'] || first['Account Name']);
    if (nameMatch) {
      queuePartsSaleForReview_(invoiceNo, first, lines, nameMatch['Dealer Code']);
      return 'review';
    }
    return 'skipped'; // no GST match, no name match — genuine Main Dealer sale
  }

  var dealerCode = dealer['Dealer Code'];
  var existingDetail = findRows(SHEETS.PARTS_SALE_DETAIL, { 'Invoice No': invoiceNo, 'Dealer Code': dealerCode });
  var newTotal = lines.reduce(function (s, l) { return s + parseAmount_(l['Final Line Item Invoice Amt']); }, 0);

  if (existingDetail.length === 0) {
    postPartsSaleLedgerEntry_(dealerCode, invoiceNo, newTotal, 'Parts Sale — ' + (first['Order Type'] || ''), first['Invoice Date']);
    lines.forEach(function (l) { appendPartsSaleDetailRow_(invoiceNo, dealerCode, l); });
    return 'processed';
  }

  var oldTotal = existingDetail.reduce(function (s, d) { return s + Number(d['Final Amount'] || 0); }, 0);
  if (Math.abs(oldTotal - newTotal) < 0.01) return 'skipped';

  reverseLedgerEntry_('Parts Sale', dealerCode, invoiceNo, oldTotal, true, 'Reversed for re-import — Parts invoice ' + invoiceNo + ' data changed');
  postPartsSaleLedgerEntry_(dealerCode, invoiceNo, newTotal, 'Parts Sale — corrected', first['Invoice Date']);
  deleteRowsWhere_(SHEETS.PARTS_SALE_DETAIL, existingDetail);
  lines.forEach(function (l) { appendPartsSaleDetailRow_(invoiceNo, dealerCode, l); });
  return 'updated';
}

function postPartsSaleLedgerEntry_(dealerCode, invoiceNo, amount, remarks, date) {
  var parsedDate = parseInvoiceDate_(date);
  appendRow(SHEETS.LEDGER_TRANSACTIONS, {
    'Entry ID': generateId('LED'),
    'Date': parsedDate,
    'Invoice No': invoiceNo,
    'Head': 'Parts Sale',
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

function appendPartsSaleDetailRow_(invoiceNo, dealerCode, line) {
  appendRow(SHEETS.PARTS_SALE_DETAIL, {
    'Detail ID': generateId('PSD'),
    'Invoice No': invoiceNo,
    'Dealer Code': dealerCode,
    'Order Type': line['Order Type'] || '',
    'Customer Name': line['Customer Name'] || '',
    'Part Description': line['Part / Labour Description'] || '',
    'Part Number': line['Part / Labour Number'] || '',
    'HSN Code': line['HSN / SAC Code'] || '',
    'Qty': line['QTY Shipped'] || '',
    'Taxable Amount': parseAmount_(line['Taxable Amount']),
    'Total Tax': parseAmount_(line['Total Tax']),
    'Final Amount': parseAmount_(line['Final Line Item Invoice Amt']),
    'Created On': new Date(),
    'Invoice Date': line['Invoice Date'] ? parseInvoiceDate_(line['Invoice Date']) : ''
  }, 'System (Import)');
}

function queuePartsSaleForReview_(invoiceNo, first, lines, suggestedDealerCode) {
  if (findRows(SHEETS.PARTS_SALE_REVIEW_QUEUE, { 'Invoice No': invoiceNo }).length > 0) return; // already queued from an earlier import run
  var total = lines.reduce(function (s, l) { return s + parseAmount_(l['Final Line Item Invoice Amt']); }, 0);
  appendRow(SHEETS.PARTS_SALE_REVIEW_QUEUE, {
    'Queue ID': generateId('PRQ'),
    'Invoice No': invoiceNo,
    'Invoice Date': first['Invoice Date'] || '',
    'Account Name': first['Account  Name'] || first['Account Name'] || '',
    'Account GSTIN': first['Account  GSTIN'] || first['Account GSTIN'] || '',
    'Order Type': first['Order Type'] || '',
    'Total Invoice Value': total,
    'Suggested Dealer Code': suggestedDealerCode,
    'Status': 'Pending',
    'Assigned Dealer Code': '',
    'Assigned By': '',
    'Assigned On': ''
  }, 'System (Import)');
  // Store line-item detail now (tagged with the suggested dealer code) so the invoice
  // popup already works — if Admin assigns to a different dealer later, assignPartsSaleReview
  // re-tags these same rows rather than losing/recreating them.
  lines.forEach(function (l) { appendPartsSaleDetailRow_(invoiceNo, suggestedDealerCode, l); });
}

/**
 * Diff-based cancellation detection (see file header). Compares invoices
 * already sitting in Parts_Sale_Detail whose date falls within this file's
 * own min/max Invoice Date against the invoice numbers actually present in
 * the file. Only reverses if the match ratio clears the configured threshold.
 */
/**
 * An invoice that was imported before but is missing from a newer report
 * covering the same dates is treated as cancelled, and reversed.
 *
 * Two fixes over the original:
 *  - The window is now compared invoice-date to invoice-date. It used to
 *    compare the file's invoice dates against each detail row's Created On
 *    (when it was IMPORTED), so an invoice dated 31 Jul but imported on 1 Aug
 *    sat inside an August file's window, was "missing" from it, and got
 *    reversed even though it was never cancelled. File dates were also read
 *    with new Date(), which reads 05/08/2026 as May 8th.
 *  - Detail rows written before the Invoice Date column existed have no date
 *    to compare, so they are left out of this check entirely rather than
 *    guessed at. A missed auto-cancel is recoverable by hand; a false one
 *    silently takes money off a dealer.
 * The reversal itself is idempotent (see reverseLedgerEntry_), so a re-upload
 * never reverses the same invoice twice.
 */
function detectAndReverseMissingPartsInvoices_(mainDealerRows) {
  if (mainDealerRows.length === 0) return 0;
  var dates = mainDealerRows
    .map(function (r) { return r['Invoice Date'] ? parseInvoiceDate_(r['Invoice Date']) : null; })
    .filter(function (d) { return d && !isNaN(d.getTime()); });
  if (dates.length === 0) return 0;
  var minDate = new Date(Math.min.apply(null, dates));
  var maxDate = new Date(Math.max.apply(null, dates));

  var fileInvoiceNumbers = {};
  mainDealerRows.forEach(function (r) { fileInvoiceNumbers[r['Invoice Number']] = true; });

  var existingDetailRows = getAllRows(SHEETS.PARTS_SALE_DETAIL);
  var existingInvoiceNumbers = {};
  existingDetailRows.forEach(function (d) {
    if (!d['Invoice Date']) return; // written before this column existed — see note above
    var dt = parseInvoiceDate_(d['Invoice Date']);
    if (dt >= minDate && dt <= maxDate) existingInvoiceNumbers[d['Invoice No']] = true;
  });

  var existingList = Object.keys(existingInvoiceNumbers);
  if (existingList.length === 0) return 0;

  var matchedCount = existingList.filter(function (inv) { return fileInvoiceNumbers[inv]; }).length;
  var matchRatio = matchedCount / existingList.length;
  if (matchRatio < PARTS_CANCEL_MATCH_THRESHOLD) {
    Logger.log('Parts cancellation-by-diff skipped: match ratio ' + (matchRatio * 100).toFixed(1) + '% is below the ' +
      (PARTS_CANCEL_MATCH_THRESHOLD * 100) + '% safety threshold. No invoices auto-reversed — check the uploaded file.');
    return 0;
  }

  var missing = existingList.filter(function (inv) { return !fileInvoiceNumbers[inv]; });
  var reversedCount = 0;
  missing.forEach(function (invoiceNo) {
    var rowsForInvoice = existingDetailRows.filter(function (d) { return d['Invoice No'] === invoiceNo; });
    if (rowsForInvoice.length === 0) return;
    var dealerCode = rowsForInvoice[0]['Dealer Code'];
    var amount = rowsForInvoice.reduce(function (s, d) { return s + Number(d['Final Amount'] || 0); }, 0);
    if (reverseLedgerEntry_('Parts Sale', dealerCode, invoiceNo, amount, true,
        'Reversed — Parts invoice ' + invoiceNo + ' no longer appears in Sales Tax Report for this period (treated as cancelled)')) {
      reversedCount++;
    }
  });
  return reversedCount;
}

// ------------------------------------------------------- Admin assignment --
function listPartsSaleReviewQueue(token) {
  return safeRun('listPartsSaleReviewQueue', function () {
    requireRole_(token, PERMISSIONS.PartsSaleReview.view);
    return getAllRows(SHEETS.PARTS_SALE_REVIEW_QUEUE).sort(function (a, b) { return new Date(b['Invoice Date']) - new Date(a['Invoice Date']); });
  });
}

function assignPartsSaleReview(token, queueId, dealerCode) {
  return safeRun('assignPartsSaleReview', function () {
    var session = requireRole_(token, PERMISSIONS.PartsSaleReview.assign);

    // See submitVehicleSaleReview's comment for why this lock exists.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var queueRow = findRow(SHEETS.PARTS_SALE_REVIEW_QUEUE, 'Queue ID', queueId);
      if (!queueRow) throw new Error('Review item not found: ' + queueId);
      if (queueRow.Status !== 'Pending') throw new Error('This item is already ' + queueRow.Status + '.');
      if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode)) throw new Error('Dealer not found: ' + dealerCode);

      var detailRows = findRows(SHEETS.PARTS_SALE_DETAIL, { 'Invoice No': queueRow['Invoice No'] });
      if (dealerCode !== queueRow['Suggested Dealer Code']) {
        detailRows.forEach(function (d) {
          updateRowWhere(SHEETS.PARTS_SALE_DETAIL, 'Detail ID', d['Detail ID'], { 'Dealer Code': dealerCode }, session.username);
        });
      }
      var total = detailRows.reduce(function (s, d) { return s + Number(d['Final Amount'] || 0); }, 0);
      postPartsSaleLedgerEntry_(dealerCode, queueRow['Invoice No'], total, 'Parts Sale — assigned by ' + session.username + ' (name-matched, no GST on file)', queueRow['Invoice Date']);

      updateRowWhere(SHEETS.PARTS_SALE_REVIEW_QUEUE, 'Queue ID', queueId, {
        'Status': 'Assigned',
        'Assigned Dealer Code': dealerCode,
        'Assigned By': session.username,
        'Assigned On': new Date()
      }, session.username);
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

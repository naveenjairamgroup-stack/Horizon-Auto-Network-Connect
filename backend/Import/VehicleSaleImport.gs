/**
 * VehicleSaleImport.gs
 * ASC-billed vehicle sales — Vehicle_Sale.csv export. Rules confirmed in chat:
 *   - Match by "Assigned To (DSE) Name" (normalized) against Dealer_Master's
 *     "Vehicle Sale Alias" column — EXACT match only, no fuzzy fallback (the
 *     naming is too different between dealers to safely guess — see the
 *     RISHU AUTOMOBILE example from chat).
 *   - Only Status = 'New' rows are considered fresh; 'Cancelled' reverses an
 *     already-processed invoice (same as Inter Dealer Sale).
 *   - A matched invoice does NOT post straight to the ledger — it goes to
 *     Vehicle_Sale_Review_Queue, Status = 'Pending', for the Network Manager
 *     to fill in Registration/Insurance/EW/HPA before it posts (see
 *     submitVehicleSaleReview below).
 *   - Once submitted, TWO ledger lines post (matching the dealer's original
 *     Tally pattern):
 *       Debit  — Head 'Vehicle Sale',            Remarks = Customer Name,  amount = Total
 *       Credit — Head 'Finance Company Advance', Remarks = Financier Name, amount = Finance Amount
 *     (Credit line only exists if Purchase Type = Finance. If Financier =
 *     'Others', the Hypothecation column's value is used as the name instead.)
 *   - Network Manager can edit their own submission for
 *     VEHICLE_SALE_EDIT_WINDOW_MINUTES (60) after submitting; after that,
 *     only Admin/Accounts can correct it.
 */

function runAscVehicleSaleImport_(actor) {
  var files = listFilesInFolder_(IMPORT_SUBFOLDERS.VEHICLE_SALE);
  var processed = 0, skipped = 0, updated = 0, reversed = 0;

  files.forEach(function (file) {
    var rows = readTsvUtf16File_(file);
    var grouped = groupBy_(rows, 'Invoice #');

    grouped.order.forEach(function (invoiceNo) {
      var frames = grouped.groups[invoiceNo];
      var result = processAscVehicleInvoice_(invoiceNo, frames);
      if (result === 'processed') processed++;
      else if (result === 'skipped') skipped++;
      else if (result === 'reversed') reversed++;
    });

    logImportRun_(file.getName(), 'Vehicle_Sale', processed, skipped, updated, reversed, 'Success');
  });

  return { folder: 'Vehicle_Sale', files: files.length, processed: processed, skipped: skipped, updated: updated, reversed: reversed };
}

function processAscVehicleInvoice_(invoiceNo, frames) {
  var first = frames[0];
  var dealer = findDealerByVehicleSaleAlias_(first['Assigned To (DSE) Name']);
  if (!dealer) return 'skipped'; // not one of our ASC network dealers (no alias configured, or genuine Main Dealer retail)
  var dealerCode = dealer['Dealer Code'];

  var allCancelled = frames.every(function (f) { return f.Status === 'Cancelled'; });
  var allNew = frames.every(function (f) { return f.Status === 'New'; });

  var queueRow = findRow(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Invoice No', invoiceNo);

  if (allCancelled) {
    if (!queueRow) return 'skipped'; // never seen before, nothing to undo
    if (queueRow.Status === 'Pending') {
      updateRowWhere(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Invoice No', invoiceNo, { 'Status': 'Cancelled' }, 'System (Import)');
      return 'reversed';
    }
    if (queueRow.Status === 'Submitted') {
      reverseAscVehicleLedgerEntries_(queueRow);
      updateRowWhere(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Invoice No', invoiceNo, { 'Status': 'Cancelled' }, 'System (Import)');
      return 'reversed';
    }
    return 'skipped';
  }

  if (!allNew) return 'skipped'; // mixed/unexpected status — needs a human look, don't guess
  if (queueRow) return 'skipped'; // already queued (Pending) or already actioned (Submitted) — nothing new to do

  var frameNumbers = frames.map(function (f) { return f['Frame #']; }).filter(Boolean).join(', ');
  var modelInfo = (first['Model Name'] || '') + (first['Model Variant'] ? (' — ' + first['Model Variant']) : '') + (first['Color'] ? (' — ' + first['Color']) : '');
  var totalInvoiceAmount = frames.reduce(function (s, f) { return s + parseAmount_(f['Total Invoice Amount']); }, 0);
  var financeAmount = frames.reduce(function (s, f) { return s + parseAmount_(f['Finance Amount']); }, 0);

  appendRow(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, {
    'Queue ID': generateId('VRQ'),
    'Invoice No': invoiceNo,
    'Dealer Code': dealerCode,
    'Customer Name': buildCustomerName_(first),
    'Frame Numbers': frameNumbers,
    'Model Info': modelInfo,
    'Total Invoice Amount': totalInvoiceAmount,
    'Purchase Type': first['Purchase Type'] || '',
    'Financier': first['Financier'] || '',
    'Hypothecation': first['Hypothecation'] || '',
    'Finance Amount': financeAmount,
    'Registration Type': '',
    'Registration Amount': '',
    'Insurance Type': '',
    'Insurance Amount': '',
    'EW Type': '',
    'EW Amount': '',
    'HPA Amount': '',
    'Status': 'Pending',
    'Submitted By': '',
    'Submitted On': '',
    'Invoice Date': first['Invoice Date'] || ''
  }, 'System (Import)');

  // Per-frame detail (Source = 'ASC') so the popup has the frame list ready
  // even before the Network Manager submits the extra charges.
  frames.forEach(function (f) { appendVehicleSaleDetailRow_(invoiceNo, dealerCode, 'ASC', f); });

  return 'processed';
}

function reverseAscVehicleLedgerEntries_(queueRow) {
  var dealerCode = queueRow['Dealer Code'];
  var invoiceNo = queueRow['Invoice No'];
  var debitTotal = computeAscTotalAmount_(queueRow);
  reverseLedgerEntry_('Vehicle Sale', dealerCode, invoiceNo, debitTotal, true, 'Reversed — ASC vehicle sale invoice ' + invoiceNo + ' shows Cancelled / being corrected');
  if (String(queueRow['Purchase Type']).toLowerCase() === 'finance') {
    var financeAmt = parseAmount_(queueRow['Finance Amount']);
    if (financeAmt > 0) {
      reverseLedgerEntry_('Finance Company Advance', dealerCode, invoiceNo, financeAmt, false, 'Reversed — ASC vehicle sale invoice ' + invoiceNo + ' shows Cancelled / being corrected');
    }
  }
}

function computeAscTotalAmount_(queueRow) {
  var extras = ['Registration Amount', 'Insurance Amount', 'EW Amount', 'HPA Amount']
    .reduce(function (s, key) { return s + parseAmount_(queueRow[key]); }, 0);
  return parseAmount_(queueRow['Total Invoice Amount']) + extras;
}

// -------------------------------------------------- Network Manager review --
function listVehicleSaleReviews(token) {
  return safeRun('listVehicleSaleReviews', function () {
    requireRole_(token, PERMISSIONS.VehicleSaleReview.view);
    var names = getDealerNameMap_();
    return getAllRows(SHEETS.VEHICLE_SALE_REVIEW_QUEUE)
      .map(function (r) {
        var out = {};
        Object.keys(r).forEach(function (k) { out[k] = r[k]; });
        out['Dealer Name'] = names[r['Dealer Code']] || '';
        return out;
      })
      .sort(function (a, b) { return new Date(b['Submitted On'] || 0) - new Date(a['Submitted On'] || 0); });
  });
}

/**
 * Submits (first time) or edits (within the window) a Network Manager's
 * review of an ASC vehicle-sale invoice. formData:
 *   { registrationType, registrationAmount, insuranceType, insuranceAmount,
 *     ewType, ewAmount, hpaAmount, financierOverride, financeAmountOverride }
 * registrationType must be 'TR Only' | 'Permanent Registration' | 'No Registration'.
 * insuranceType 'Insurance from Outside' zeroes the amount; ewType 'No EW' zeroes the amount.
 */
function submitVehicleSaleReview(token, queueId, formData) {
  return safeRun('submitVehicleSaleReview', function () {
    var session = requireRole_(token, PERMISSIONS.VehicleSaleReview.submit);

    // Without this lock, two near-simultaneous submissions of the SAME
    // invoice (a double-click, or a retry after a slow/failed network
    // response) can each read the row while it still says "Pending",
    // meaning neither sees the other as an edit — both skip the reversal
    // below and post a fresh set of ledger entries, stacking duplicates.
    // The lock forces the second call to wait until the first one has
    // fully finished (including its ledger posting), so it reads the
    // now-"Submitted" status correctly and reverses before re-posting.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var queueRow = findRow(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Queue ID', queueId);
      if (!queueRow) throw new Error('Review item not found: ' + queueId);
      if (queueRow.Status === 'Cancelled') throw new Error('This invoice was cancelled — nothing to submit.');

      var isEdit = queueRow.Status === 'Submitted';
      if (isEdit) {
        var isAdminOrAccounts = session.role === ROLES.ADMIN || session.role === ROLES.ACCOUNTS;
        if (!isAdminOrAccounts) {
          if (session.username !== queueRow['Submitted By']) {
            throw new Error('Only the original submitter, or Admin/Accounts, can edit this.');
          }
          var minutesSinceSubmit = (new Date() - new Date(queueRow['Submitted On'])) / 60000;
          if (minutesSinceSubmit > VEHICLE_SALE_EDIT_WINDOW_MINUTES) {
            throw new Error('The ' + VEHICLE_SALE_EDIT_WINDOW_MINUTES + '-minute edit window has passed. Ask Admin or Accounts to correct this.');
          }
        }
        reverseAscVehicleLedgerEntries_(queueRow); // undo the previously-posted entries before posting corrected ones
      }

      requireFields(formData, ['registrationType']);
      if (['TR Only', 'Permanent Registration', 'No Registration'].indexOf(formData.registrationType) === -1) {
        throw new Error('Registration Type must be TR Only, Permanent Registration, or No Registration.');
      }
      var hpaDisabled = formData.registrationType === 'TR Only' || formData.registrationType === 'No Registration';

      var updates = {
        'Registration Type': formData.registrationType,
        'Registration Amount': Number(formData.registrationAmount) || 0,
        'Insurance Type': formData.insuranceType || 'Amount',
        'Insurance Amount': formData.insuranceType === 'Insurance from Outside' ? 0 : (Number(formData.insuranceAmount) || 0),
        'EW Type': formData.ewType || 'Amount',
        'EW Amount': formData.ewType === 'No EW' ? 0 : (Number(formData.ewAmount) || 0),
        'HPA Amount': hpaDisabled ? 0 : (Number(formData.hpaAmount) || 0),
        'Status': 'Submitted',
        'Submitted By': session.username,
        'Submitted On': new Date()
      };
      if (formData.financierOverride) updates['Financier'] = formData.financierOverride;
      if (formData.financeAmountOverride !== undefined && formData.financeAmountOverride !== '') {
        updates['Finance Amount'] = Number(formData.financeAmountOverride) || 0;
      }
      updateRowWhere(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Queue ID', queueId, updates, session.username);

      var finalRow = findRow(SHEETS.VEHICLE_SALE_REVIEW_QUEUE, 'Queue ID', queueId);
      var dealerCode = finalRow['Dealer Code'];
      var invoiceNo = finalRow['Invoice No'];
      var totalAmount = computeAscTotalAmount_(finalRow);

      postVehicleSaleLedgerEntry_(dealerCode, invoiceNo, totalAmount, finalRow['Customer Name'] || ('Vehicle sale ' + invoiceNo), finalRow['Invoice Date']);

      if (String(finalRow['Purchase Type']).toLowerCase() === 'finance') {
        var financierName = (String(finalRow['Financier']).toLowerCase() === 'others')
          ? finalRow['Hypothecation']
          : finalRow['Financier'];
        var financeAmount = parseAmount_(finalRow['Finance Amount']);
        if (financeAmount > 0 && financierName) {
          var financeParsedDate = parseInvoiceDate_(finalRow['Invoice Date']);
          appendRow(SHEETS.LEDGER_TRANSACTIONS, {
            'Entry ID': generateId('LED'),
            'Date': financeParsedDate,
            'Invoice No': invoiceNo,
            'Head': 'Finance Company Advance',
            'Dealer Code': dealerCode,
            'Debit': 0,
            'Credit': financeAmount,
            'Running Balance': 0,
            'Remarks': financierName,
            'Created By': session.username,
            'Timestamp': new Date(),
            'Invoice Date': financeParsedDate
          }, session.username);
          recomputeRunningBalance_(dealerCode);
        }
      }
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

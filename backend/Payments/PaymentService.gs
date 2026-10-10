/**
 * PaymentService.gs
 * Payments raised by a Dealer (own account) or a Network Manager (on behalf
 * of any dealer in their network). Accounts reviews and approves/rejects —
 * only on approval does it post to the ledger as a Credit (see architecture
 * doc, section 6).
 */

function submitPayment(token, payment) {
  return safeRun('submitPayment', function () {
    var session = requireRole_(token, PERMISSIONS.Payments.submit);
    requireFields(payment, ['Dealer Code', 'Mode', 'Amount', 'Date']);
    if (session.role === ROLES.DEALER && session.dealerCode !== payment['Dealer Code']) {
      throw new Error('You can only submit payments for your own dealer account.');
    }
    if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', payment['Dealer Code'])) {
      throw new Error('Dealer not found: ' + payment['Dealer Code']);
    }
    var amount = Math.abs(Number(payment.Amount) || 0);
    if (amount === 0) throw new Error('Amount must be greater than zero.');

    // A payment that matches an existing Pending/Approved one on dealer,
    // amount, date and reference is far more likely a repeat than a second
    // genuine payment — so ask, rather than add it silently. The frontend
    // re-sends with payment.force = true once the user confirms. (Double
    // clicks and proxy retries are already absorbed earlier, by the request
    // de-duplication in Code.gs; this catches the "submitted it again by
    // hand" case.)
    if (!payment.force) {
      var match = findDuplicatePayment_(payment['Dealer Code'], amount, payment.Date, payment['Reference No']);
      if (match) {
        return {
          needsConfirm: true,
          message: 'A payment of ' + formatCurrency(amount) + ' for this dealer on this date' +
            (payment['Reference No'] ? ' with reference ' + payment['Reference No'] : '') +
            ' already exists (' + match['Approval Status'] + ', ' + match['Payment ID'] + '). Add it again anyway?',
          existingId: match['Payment ID']
        };
      }
    }

    var row = {
      'Payment ID': generateId('PAY'),
      'Dealer Code': payment['Dealer Code'],
      'Mode': payment.Mode,
      'Amount': amount,
      'Reference No': payment['Reference No'] || '',
      'Date': payment.Date,
      'Submitted By': session.username,
      'Submitted Role': session.role,
      'Approval Status': APPROVAL_STATUS.PENDING,
      'Approved By': '',
      'Approved On': '',
      'Posted To Ledger': false,
      'Remarks': payment.Remarks || ''
    };
    appendRow(SHEETS.PAYMENT_ENTRIES, row, session.username);
    return row;
  });
}

/**
 * Pending/Approved payment with the same dealer, amount and date — and the
 * same reference, when one was given. Two cash payments of the same amount
 * on the same day are rare but real, so this only ever prompts, never blocks.
 */
function findDuplicatePayment_(dealerCode, amount, date, referenceNo) {
  var day = Utilities.formatDate(istDayStart_(date), 'Asia/Kolkata', 'yyyy-MM-dd');
  var ref = String(referenceNo || '').trim().toUpperCase();
  var rows = getAllRows(SHEETS.PAYMENT_ENTRIES);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r['Dealer Code']) !== String(dealerCode)) continue;
    if (!PAYMENT_DUPLICATE_STATUSES[r['Approval Status']]) continue;
    if (Math.abs((Number(r.Amount) || 0) - amount) > 0.005) continue;
    var rDay = r.Date ? Utilities.formatDate(new Date(r.Date), 'Asia/Kolkata', 'yyyy-MM-dd') : '';
    if (rDay !== day) continue;
    var rRef = String(r['Reference No'] || '').trim().toUpperCase();
    if (ref && rRef && ref !== rRef) continue; // different references = different payments
    return r;
  }
  return null;
}

/**
 * filters: a status string (the old signature, still accepted), or
 *   { status, dealerCode, mode, fromDate, toDate } — any combination, all optional.
 */
function listPayments(token, filters) {
  return safeRun('listPayments', function () {
    var session = requireRole_(token, PERMISSIONS.Payments.view);
    var f = (typeof filters === 'string') ? { status: filters } : (filters || {});
    var rows = getAllRows(SHEETS.PAYMENT_ENTRIES);
    if (session.role === ROLES.DEALER) {
      rows = rows.filter(function (r) { return r['Dealer Code'] === session.dealerCode; });
    }
    if (f.status) rows = rows.filter(function (r) { return r['Approval Status'] === f.status; });
    if (f.dealerCode) rows = rows.filter(function (r) { return String(r['Dealer Code']) === String(f.dealerCode); });
    if (f.mode) rows = rows.filter(function (r) { return String(r.Mode) === String(f.mode); });
    if (f.fromDate) {
      var from = istDayStart_(f.fromDate);
      rows = rows.filter(function (r) { return new Date(r.Date) >= from; });
    }
    if (f.toDate) {
      var to = istDayEnd_(f.toDate);
      rows = rows.filter(function (r) { return new Date(r.Date) <= to; });
    }
    // Payment_Entries only stores the code; the table shows the name next to it.
    var names = getDealerNameMap_();
    return rows.map(function (r) {
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      out['Dealer Name'] = names[r['Dealer Code']] || '';
      return out;
    }).sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });
  });
}

function approvePayment(token, paymentId) {
  return safeRun('approvePayment', function () {
    var session = requireRole_(token, PERMISSIONS.Payments.approve);

    // See submitVehicleSaleReview's comment for why this lock exists — a
    // double-click or retry approving the SAME payment twice in quick
    // succession could otherwise both read "Pending" and both post a
    // ledger credit, with no reversal step here to undo the duplicate.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var payment = findRow(SHEETS.PAYMENT_ENTRIES, 'Payment ID', paymentId);
      if (!payment) throw new Error('Payment not found: ' + paymentId);
      if (payment['Approval Status'] !== APPROVAL_STATUS.PENDING) {
        throw new Error('This payment is already ' + payment['Approval Status'] + '.');
      }
      updateRowWhere(SHEETS.PAYMENT_ENTRIES, 'Payment ID', paymentId, {
        'Approval Status': APPROVAL_STATUS.APPROVED,
        'Approved By': session.username,
        'Approved On': new Date(),
        'Posted To Ledger': true
      }, session.username);

      var entryRow = {
        'Entry ID': generateId('LED'),
        'Date': payment.Date,
        'Invoice No': payment['Reference No'] || '',
        'Head': 'Payment Received',
        'Dealer Code': payment['Dealer Code'],
        'Debit': 0,
        'Credit': Number(payment.Amount),
        'Running Balance': 0,
        'Remarks': 'Payment (' + payment.Mode + ') approved by ' + session.username,
        'Created By': session.username,
        'Timestamp': new Date()
      };
      appendRow(SHEETS.LEDGER_TRANSACTIONS, entryRow, session.username);
      recomputeRunningBalance_(payment['Dealer Code']);
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

function rejectPayment(token, paymentId, reason) {
  return safeRun('rejectPayment', function () {
    var session = requireRole_(token, PERMISSIONS.Payments.approve);
    var payment = findRow(SHEETS.PAYMENT_ENTRIES, 'Payment ID', paymentId);
    if (!payment) throw new Error('Payment not found: ' + paymentId);
    if (payment['Approval Status'] !== APPROVAL_STATUS.PENDING) {
      throw new Error('This payment is already ' + payment['Approval Status'] + '.');
    }
    updateRowWhere(SHEETS.PAYMENT_ENTRIES, 'Payment ID', paymentId, {
      'Approval Status': APPROVAL_STATUS.REJECTED,
      'Approved By': session.username,
      'Approved On': new Date(),
      'Remarks': (payment.Remarks || '') + ' | Rejected: ' + (reason || '')
    }, session.username);
    return true;
  });
}

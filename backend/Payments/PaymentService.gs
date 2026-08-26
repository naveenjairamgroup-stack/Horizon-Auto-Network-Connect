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

function listPayments(token, filterStatus) {
  return safeRun('listPayments', function () {
    var session = requireRole_(token, PERMISSIONS.Payments.view);
    var rows = getAllRows(SHEETS.PAYMENT_ENTRIES);
    if (session.role === ROLES.DEALER) {
      rows = rows.filter(function (r) { return r['Dealer Code'] === session.dealerCode; });
    }
    if (filterStatus) {
      rows = rows.filter(function (r) { return r['Approval Status'] === filterStatus; });
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

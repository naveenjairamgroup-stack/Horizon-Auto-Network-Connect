/**
 * ReturnService.gs
 * Vehicle/Parts return entries — any dealer type (AD, ASC, FO) can raise one.
 * Dealer or Network Manager submits with a mandatory tax-invoice attachment;
 * the Network Manager approves (final — no second Accounts check). Entries
 * whose Invoice Date is more than RETURN_BACKDATE_LIMIT_DAYS old can only be
 * submitted by Admin/Accounts (see architecture doc, section 6).
 */

function submitReturn(token, ret) {
  return safeRun('submitReturn', function () {
    var session = requireRole_(token, PERMISSIONS.Returns.submit);
    requireFields(ret, ['Dealer Code', 'Return Type', 'Invoice No', 'Invoice Date', 'Total Amount', 'Attachment Link']);
    if (session.role === ROLES.DEALER && session.dealerCode !== ret['Dealer Code']) {
      throw new Error('You can only submit returns for your own dealer account.');
    }
    if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', ret['Dealer Code'])) {
      throw new Error('Dealer not found: ' + ret['Dealer Code']);
    }
    if (['Vehicle', 'Parts'].indexOf(ret['Return Type']) === -1) {
      throw new Error('Return Type must be Vehicle or Parts.');
    }
    if (ret['Return Type'] === 'Vehicle' && !isNonEmpty(ret['Frame Numbers'])) {
      throw new Error('At least one Frame Number is required for a Vehicle return.');
    }
    if (ret['Return Type'] === 'Parts' && !isNonEmpty(ret['Part Description'])) {
      throw new Error('Part Description is required for a Parts return.');
    }

    var invoiceDate = new Date(ret['Invoice Date']);
    var daysOld = Math.floor((new Date() - invoiceDate) / (1000 * 60 * 60 * 24));
    var isLate = daysOld > RETURN_BACKDATE_LIMIT_DAYS;
    if (isLate && [ROLES.ADMIN, ROLES.ACCOUNTS].indexOf(session.role) === -1) {
      throw new Error('This invoice is ' + daysOld + ' days old (more than ' + RETURN_BACKDATE_LIMIT_DAYS + '). Only Admin or Accounts can enter a return this old.');
    }

    var amount = Math.abs(Number(ret['Total Amount']) || 0);
    if (amount === 0) throw new Error('Total Amount must be greater than zero.');

    var row = {
      'Return ID': generateId('RET'),
      'Dealer Code': ret['Dealer Code'],
      'Return Type': ret['Return Type'],
      'Invoice No': ret['Invoice No'],
      'Invoice Date': ret['Invoice Date'],
      'Frame Numbers': ret['Frame Numbers'] || '',
      'Part Description': ret['Part Description'] || '',
      'Total Amount': amount,
      'Attachment Link': ret['Attachment Link'],
      'Submitted By': session.username,
      'Submitted Role': session.role,
      'Approval Status': APPROVAL_STATUS.PENDING,
      'Approved By': '',
      'Approved On': '',
      'Posted To Ledger': false,
      'Late Entry': isLate
    };
    appendRow(SHEETS.RETURN_ENTRIES, row, session.username);
    return row;
  });
}

function listReturns(token, filterStatus) {
  return safeRun('listReturns', function () {
    var session = requireRole_(token, PERMISSIONS.Returns.view);
    var rows = getAllRows(SHEETS.RETURN_ENTRIES);
    if (session.role === ROLES.DEALER) {
      rows = rows.filter(function (r) { return r['Dealer Code'] === session.dealerCode; });
    }
    if (filterStatus) {
      rows = rows.filter(function (r) { return r['Approval Status'] === filterStatus; });
    }
    return rows.sort(function (a, b) { return new Date(b['Invoice Date']) - new Date(a['Invoice Date']); });
  });
}

function approveReturn(token, returnId) {
  return safeRun('approveReturn', function () {
    var session = requireRole_(token, PERMISSIONS.Returns.approve);

    // See submitVehicleSaleReview's comment for why this lock exists.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ret = findRow(SHEETS.RETURN_ENTRIES, 'Return ID', returnId);
      if (!ret) throw new Error('Return not found: ' + returnId);
      if (ret['Approval Status'] !== APPROVAL_STATUS.PENDING) {
        throw new Error('This return is already ' + ret['Approval Status'] + '.');
      }
      updateRowWhere(SHEETS.RETURN_ENTRIES, 'Return ID', returnId, {
        'Approval Status': APPROVAL_STATUS.APPROVED,
        'Approved By': session.username,
        'Approved On': new Date(),
        'Posted To Ledger': true
      }, session.username);

      var head = ret['Return Type'] === 'Vehicle' ? 'Vehicle Purchase / Return' : 'Parts Purchase / Return';
      var entryRow = {
        'Entry ID': generateId('LED'),
        'Date': ret['Invoice Date'],
        'Invoice No': ret['Invoice No'],
        'Head': head,
        'Dealer Code': ret['Dealer Code'],
        'Debit': 0,
        'Credit': Number(ret['Total Amount']),
        'Running Balance': 0,
        'Remarks': ret['Return Type'] + ' return approved by ' + session.username + (ret['Frame Numbers'] ? (' | Frames: ' + ret['Frame Numbers']) : ''),
        'Created By': session.username,
        'Timestamp': new Date()
      };
      appendRow(SHEETS.LEDGER_TRANSACTIONS, entryRow, session.username);
      recomputeRunningBalance_(ret['Dealer Code']);
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

function rejectReturn(token, returnId, reason) {
  return safeRun('rejectReturn', function () {
    var session = requireRole_(token, PERMISSIONS.Returns.approve);
    var ret = findRow(SHEETS.RETURN_ENTRIES, 'Return ID', returnId);
    if (!ret) throw new Error('Return not found: ' + returnId);
    if (ret['Approval Status'] !== APPROVAL_STATUS.PENDING) {
      throw new Error('This return is already ' + ret['Approval Status'] + '.');
    }
    updateRowWhere(SHEETS.RETURN_ENTRIES, 'Return ID', returnId, {
      'Approval Status': APPROVAL_STATUS.REJECTED,
      'Approved By': session.username,
      'Approved On': new Date()
    }, session.username);
    return true;
  });
}

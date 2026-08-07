/**
 * VoucherHeadMasterService.gs
 * Config-driven transaction heads (Vehicle Sale, Commission, Network FSC, etc.)
 * Ledger entries reference a head by name; OutstandingService looks up its
 * Effect here instead of ever hardcoding "Commission = credit" in code.
 */

function listVoucherHeads(token) {
  return safeRun('listVoucherHeads', function () {
    requireRole_(token, PERMISSIONS.VoucherHead.view);
    return getAllRows(SHEETS.VOUCHER_HEAD_MASTER).filter(function (h) { return String(h.Active) !== 'false'; });
  });
}

function getHeadEffect_(headName) {
  var head = findRow(SHEETS.VOUCHER_HEAD_MASTER, 'Head Name', headName);
  if (!head) throw new Error('Unknown voucher head: ' + headName + '. Ask Admin to add it in Voucher Head Master.');
  return head.Effect; // EFFECT.INCREASE or EFFECT.DECREASE
}

function addVoucherHead(token, head) {
  return safeRun('addVoucherHead', function () {
    var session = requireRole_(token, PERMISSIONS.VoucherHead.edit);
    requireFields(head, ['Head Name', 'Vch Type', 'Effect']);
    if ([EFFECT.INCREASE, EFFECT.DECREASE].indexOf(head.Effect) === -1) {
      throw new Error('Effect must be Increase or Decrease.');
    }
    if (findRow(SHEETS.VOUCHER_HEAD_MASTER, 'Head Name', head['Head Name'])) {
      throw new Error('This head already exists: ' + head['Head Name']);
    }
    head.Active = true;
    appendRow(SHEETS.VOUCHER_HEAD_MASTER, head, session.username);
    return true;
  });
}

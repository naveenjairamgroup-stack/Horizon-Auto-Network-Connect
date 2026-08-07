/**
 * DealerMasterService.gs
 * CRUD for the network partner directory (AD / ASC / FO).
 */

function createDealer(token, dealer) {
  return safeRun('createDealer', function () {
    var session = requireRole_(token, PERMISSIONS.DealerMaster.edit);
    requireFields(dealer, ['Dealer Code', 'Dealer Name', 'Type']);
    if ([DEALER_TYPES.AD, DEALER_TYPES.ASC, DEALER_TYPES.FO].indexOf(dealer.Type) === -1) {
      throw new Error('Type must be AD, ASC, or FO.');
    }
    dealer['Dealer Code'] = sanitizeString(dealer['Dealer Code']).toUpperCase();
    if (findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealer['Dealer Code'])) {
      throw new Error('Dealer Code already exists: ' + dealer['Dealer Code']);
    }
    dealer['Dealer Name'] = sanitizeString(dealer['Dealer Name']);
    if (dealer.Email && !isValidEmail(dealer.Email)) throw new Error('Invalid email address.');
    if (dealer.Mobile && !isValidMobile(dealer.Mobile)) throw new Error('Invalid mobile number.');
    dealer.Status = dealer.Status || 'Active';
    dealer['Created On'] = new Date();
    dealer['Created By'] = session.username;
    appendRow(SHEETS.DEALER_MASTER, dealer, session.username);
    return dealer;
  });
}

function updateDealer(token, dealerCode, updates) {
  return safeRun('updateDealer', function () {
    var session = requireRole_(token, PERMISSIONS.DealerMaster.edit);
    var found = updateRowWhere(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode, updates, session.username);
    if (!found) throw new Error('Dealer not found: ' + dealerCode);
    return true;
  });
}

function listDealers(token) {
  return safeRun('listDealers', function () {
    var session = requireRole_(token, PERMISSIONS.DealerMaster.view.concat([ROLES.DEALER]));
    var rows = getAllRows(SHEETS.DEALER_MASTER);
    if (session.role === ROLES.DEALER) {
      rows = rows.filter(function (r) { return r['Dealer Code'] === session.dealerCode; });
    }
    return rows;
  });
}

function getDealer(token, dealerCode) {
  return safeRun('getDealer', function () {
    var session = requireRole_(token, PERMISSIONS.DealerMaster.view.concat([ROLES.DEALER]));
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own dealer record.');
    }
    var dealer = findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode);
    if (!dealer) throw new Error('Dealer not found: ' + dealerCode);
    return dealer;
  });
}

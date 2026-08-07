/**
 * UserMasterService.gs
 * CRUD for login accounts. Every Dealer-role user must be mapped to exactly
 * one Dealer Code so ledger/dashboard queries can be scoped automatically.
 */

function createUser(token, user, tempPassword) {
  return safeRun('createUser', function () {
    var session = requireRole_(token, [ROLES.ADMIN]);
    requireFields(user, ['Username', 'Role', 'Full Name']);
    user.Username = String(user.Username || '').trim();
    if (findUserByUsername(user.Username)) {
      throw new Error('Username already exists: ' + user.Username);
    }
    if (user.Role === ROLES.DEALER) {
      if (!isNonEmpty(user['Dealer Code'])) throw new Error('Dealer Code is required for a Dealer-role user.');
      if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', user['Dealer Code'])) {
        throw new Error('No such Dealer Code in Dealer Master: ' + user['Dealer Code']);
      }
    }
    var salt = Utilities.getUuid();
    user['Password Hash'] = hashPassword_(tempPassword || 'Welcome@123', salt);
    user.Salt = salt;
    user.Active = true;
    user['Created On'] = new Date();
    user['Created By'] = session.username;
    appendRow(SHEETS.USER_MASTER, user, session.username);
    return { username: user.Username };
  });
}

function listUsers(token) {
  return safeRun('listUsers', function () {
    requireRole_(token, [ROLES.ADMIN]);
    return getAllRows(SHEETS.USER_MASTER).map(function (u) {
      var clean = Object.assign({}, u);
      delete clean['Password Hash'];
      delete clean.Salt;
      return clean;
    });
  });
}

function setUserActive(token, username, active) {
  return safeRun('setUserActive', function () {
    var session = requireRole_(token, [ROLES.ADMIN]);
    var user = findUserByUsername(username);
    if (!user) throw new Error('User not found: ' + username);
    var found = updateRowWhere(SHEETS.USER_MASTER, 'Username', user.Username, { Active: !!active }, session.username);
    if (!found) throw new Error('User not found: ' + username);
    return true;
  });
}

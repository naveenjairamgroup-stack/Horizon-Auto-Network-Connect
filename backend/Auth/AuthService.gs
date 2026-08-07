/**
 * AuthService.gs
 * Login / logout / password management. Passwords are never stored or
 * compared in plain text — see hashPassword_ in Utilities.gs.
 */

if (typeof normalizeUsername !== 'function') {
  normalizeUsername = function (value) {
    return String(value || '').trim().toLowerCase();
  };
}

function findUserByUsername(username) {
  var norm = normalizeUsername(username);
  if (!norm) return null;
  var users = getAllRows(SHEETS.USER_MASTER);
  for (var i = 0; i < users.length; i++) {
    if (normalizeUsername(users[i].Username) === norm) return users[i];
  }
  return null;
}

function login(username, password) {
  return safeRun('login', function () {
    requireFields({ username: username, password: password }, ['username', 'password']);
    var user = findUserByUsername(username);
    if (!user || String(user.Active) !== 'true') {
      logLoginAttempt_(username, false);
      throw new Error('Invalid username or password.');
    }
    var hash = hashPassword_(password, user.Salt);
    if (hash !== user['Password Hash']) {
      logLoginAttempt_(username, false);
      throw new Error('Invalid username or password.');
    }
    var token = createSession_(user);
    updateRowWhere(SHEETS.USER_MASTER, 'Username', user.Username, { 'Last Login': new Date() }, user.Username);
    logLoginAttempt_(username, true);
    return {
      token: token,
      username: user.Username,
      role: user.Role,
      dealerCode: user['Dealer Code'],
      fullName: user['Full Name']
    };
  });
}

function logout(token) {
  return safeRun('logout', function () {
    var session = validateSession(token);
    if (session) {
      updateRowWhere(SHEETS.LOGIN_HISTORY, 'Username', session.username, { 'Logout Time': new Date() }, session.username);
    }
    destroySession(token);
    return true;
  });
}

function changePassword(token, oldPassword, newPassword) {
  return safeRun('changePassword', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.NETWORK_MANAGER, ROLES.ACCOUNTS, ROLES.DEALER]);
    var user = findRow(SHEETS.USER_MASTER, 'Username', session.username);
    if (hashPassword_(oldPassword, user.Salt) !== user['Password Hash']) {
      throw new Error('Current password is incorrect.');
    }
    if (String(newPassword || '').length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    var salt = Utilities.getUuid();
    var hash = hashPassword_(newPassword, salt);
    updateRowWhere(SHEETS.USER_MASTER, 'Username', user.Username, { 'Password Hash': hash, Salt: salt }, session.username);
    return true;
  });
}

/**
 * Admin-only reset. Generates a new temporary password (or uses one you
 * pass in) and returns it ONCE so the Admin can share it with the user —
 * the OLD password is never stored in a recoverable form, so it can never
 * be shown back to anyone, Admin included. This is intentional: it's what
 * "Password Encryption" (see spec) actually means.
 */
function resetPassword(token, targetUsername, newTempPassword) {
  return safeRun('resetPassword', function () {
    var session = requireRole_(token, [ROLES.ADMIN]);
    var user = findUserByUsername(targetUsername);
    if (!user) {
      throw new Error('User not found: ' + targetUsername);
    }
    var password = (newTempPassword && String(newTempPassword).trim())
      ? String(newTempPassword).trim()
      : generateTempPassword_();
    var salt = Utilities.getUuid();
    var hash = hashPassword_(password, salt);
    updateRowWhere(SHEETS.USER_MASTER, 'Username', user.Username, { 'Password Hash': hash, Salt: salt }, session.username);
    return { username: user.Username, newPassword: password };
  });
}

/** 8 random letters/digits (no confusing look-alikes) + a fixed suffix so it always meets the 8-char minimum. */
function generateTempPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var pwd = '';
  for (var i = 0; i < 8; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd + '@1';
}

function logLoginAttempt_(username, success) {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.LOGIN_HISTORY);
  sheet.appendRow([username, new Date(), '', '', success ? 'Success' : 'Failed']);
}

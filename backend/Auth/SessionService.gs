/**
 * SessionService.gs
 * Lightweight session tokens backed by CacheService — this gives us
 * "auto logout after inactivity" for free, via SESSION_TIMEOUT_MINUTES.
 */

function createSession_(userRow) {
  var token = Utilities.getUuid();
  var payload = {
    username: userRow.Username,
    role: userRow.Role,
    dealerCode: userRow['Dealer Code'],
    fullName: userRow['Full Name']
  };
  CacheService.getScriptCache().put(token, JSON.stringify(payload), SESSION_TIMEOUT_MINUTES * 60);
  return token;
}

/** Returns the session payload and refreshes its TTL, or null if expired/invalid. */
function validateSession(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get(token);
  if (!raw) return null;
  cache.put(token, raw, SESSION_TIMEOUT_MINUTES * 60); // refresh on activity
  return JSON.parse(raw);
}

function destroySession(token) {
  CacheService.getScriptCache().remove(token);
}

/** Throws if there's no valid session, or the role isn't in allowedRoles. Returns the session. */
function requireRole_(token, allowedRoles) {
  var session = validateSession(token);
  if (!session) throw new Error('Session expired. Please log in again.');
  if (allowedRoles && allowedRoles.indexOf(session.role) === -1) {
    throw new Error('You do not have permission to perform this action.');
  }
  return session;
}

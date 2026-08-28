/**
 * session.js
 * Shared login state. Exported as one persistent object (never reassigned)
 * so every module that imports `session` sees the same live data — ES
 * modules only allow live bindings to be READ from another module, not
 * reassigned, so login/logout go through setSession()/clearSession()
 * instead of doing `session = ...` directly.
 */

export const session = {
  token: null,
  username: null,
  fullName: null,
  role: null,
  dealerCode: null,
  dealerType: null
};

// The "-v2" suffix deliberately invalidates every session saved before
// dealerType existed. Without it, anyone already logged in would keep a
// stored session with no dealerType, and an ASC dealer would silently lose
// the Commission tab until they happened to log out. One forced re-login is
// cheaper than that confusion.
var STORAGE_KEY = 'horizon-auto-network-connect-session-v2';

function persistSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    token: session.token,
    username: session.username,
    fullName: session.fullName,
    role: session.role,
    dealerCode: session.dealerCode,
    dealerType: session.dealerType
  }));
}

export function loadSession() {
  var raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    var stored = JSON.parse(raw);
    if (!stored || !stored.token) return false;
    session.token = stored.token;
    session.username = stored.username;
    session.fullName = stored.fullName;
    session.role = stored.role;
    session.dealerCode = stored.dealerCode;
    session.dealerType = stored.dealerType || '';
    return true;
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

/** Called once, right after a successful login, with the backend's login() result. */
export function setSession(result) {
  session.token = result.token;
  session.username = result.username;
  session.fullName = result.fullName;
  session.role = result.role;
  session.dealerCode = result.dealerCode;
  session.dealerType = result.dealerType || '';
  persistSession();
}

export function clearSession() {
  session.token = null;
  session.username = null;
  session.fullName = null;
  session.role = null;
  session.dealerCode = null;
  session.dealerType = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function isLoggedIn() {
  return !!session.token;
}
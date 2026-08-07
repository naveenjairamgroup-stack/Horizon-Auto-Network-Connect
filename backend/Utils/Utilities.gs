/**
 * Utilities.gs
 * Small shared helpers: response envelope, IDs, formatting, and password hashing.
 */

/** Every function exposed to the frontend returns one of these two shapes. */
function ok(data) {
  return { success: true, data: data };
}
function fail(message) {
  return { success: false, error: message };
}

function generateId(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
}

function formatCurrency(amount) {
  var n = Number(amount) || 0;
  return '\u20b9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(date) {
  return Utilities.formatDate(new Date(date), 'Asia/Kolkata', 'dd-MMM-yyyy');
}

/** SHA-256 hash with a per-user salt. Never store or compare plain-text passwords. */
function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + String(salt));
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

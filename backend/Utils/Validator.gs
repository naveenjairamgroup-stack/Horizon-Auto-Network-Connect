/**
 * Validator.gs
 * Input validation and sanitization. Every write path calls these before
 * the data reaches SheetHelper.gs.
 */

function isNonEmpty(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function isValidMobile(value) {
  return /^[6-9]\d{9}$/.test(String(value || '').trim());
}

function isValidGST(value) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(String(value || '').trim().toUpperCase());
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

/** Strips characters that have no business being in a plain-text field. */
function sanitizeString(value) {
  return String(value || '').replace(/[<>]/g, '').trim();
}

function requireFields(obj, fields) {
  var missing = fields.filter(function (f) { return !isNonEmpty(obj[f]); });
  if (missing.length) {
    throw new Error('Missing required field(s): ' + missing.join(', '));
  }
}

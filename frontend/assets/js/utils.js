/**
 * utils.js
 * Small, dependency-free helpers shared by every page module: currency and
 * date formatting, the onclick-attribute escaping helper, status badges,
 * the toast notification, and the file-to-base64 reader used by Returns'
 * mandatory attachment upload.
 */

/**
 * Safely turns a JS value into source text that can sit inside an
 * onclick="..." (double-quoted) HTML attribute built via string
 * concatenation. Plain JSON.stringify() is NOT safe here: its output is
 * itself wrapped in double quotes, which prematurely closes the outer
 * onclick="..." attribute the moment the browser's HTML parser hits them —
 * the handler silently becomes garbage and nothing happens on click.
 * Escaping the embedded quotes as HTML entities fixes this for any value,
 * including ones containing single or double quotes.
 */
export function jsArg_(value) {
  return JSON.stringify(value).replace(/"/g, '&quot;');
}

export function formatMoney_(n) {
  n = Number(n) || 0;
  return '\u20b9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Always shows dd-mm-yyyy, regardless of what format the value arrives in (ISO string, Date, etc). */
export function formatDateDisplay_(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  var dd = String(d.getDate()).padStart(2, '0');
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyyy = d.getFullYear();
  return dd + '-' + mm + '-' + yyyy;
}

/**
 * dd-mm-yyyy HH:mm:ss in Asia/Kolkata, whatever timezone the browser is in.
 *
 * Backend timestamps arrive as UTC ISO strings ("2026-08-24T07:21:08.829Z")
 * because getAllRows converts every Date with toISOString(). Rendering those
 * raw is what showed up in the Audit and Import logs. Note this deliberately
 * does NOT rely on the browser's own timezone — a login from outside India
 * would otherwise display a different clock time for the same record.
 */
export function formatDateTimeDisplay_(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d).reduce(function (acc, p) { acc[p.type] = p.value; return acc; }, {});
  return parts.day + '-' + parts.month + '-' + parts.year + ' ' +
    parts.hour + ':' + parts.minute + ':' + parts.second;
}

/**
 * Escapes text before it goes into an innerHTML string. Import files carry
 * customer names, financier names and remarks straight through to these
 * tables, and none of that is sanitised on the way in, so anything with an
 * angle bracket in it would otherwise be parsed as markup.
 */
export function esc_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showToast_(err, successMsg) {
  var el = document.getElementById('toast');
  el.textContent = err ? (err.message || String(err)) : successMsg;
  el.className = 'toast ' + (err ? 'toast-error' : 'toast-success');
  el.style.display = 'block';
  setTimeout(function () { el.style.display = 'none'; }, 3500);
}

export function statusBadge_(status) {
  var greenSet = ['Approved', 'Submitted', 'Assigned'];
  var redSet = ['Rejected', 'Cancelled'];
  var cls = greenSet.indexOf(status) !== -1 ? 'badge-green' : (redSet.indexOf(status) !== -1 ? 'badge-red' : 'badge-yellow');
  return '<span class="badge ' + cls + '">' + status + '</span>';
}

export function creditStatusBadge_(status) {
  var cls = status === 'Red' ? 'badge-red' : (status === 'Yellow' ? 'badge-yellow' : 'badge-green');
  return '<span class="badge ' + cls + '">' + status + '</span>';
}

export function readFileAsBase64_(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result.split(',')[1]); };
    reader.onerror = function () { reject(new Error('Could not read the selected file.')); };
    reader.readAsDataURL(file);
  });
}

/**
 * Disables a button for as long as the promise it starts is running, so a
 * double click can't fire the same submit twice. (The backend also drops
 * identical repeats; this is the first line of defence and gives feedback.)
 * Usage: withBusy_(btn, function () { return api(...); })
 */
export function withBusy_(button, run) {
  if (button && button.disabled) return Promise.resolve();
  var label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'Please wait\u2026'; }
  var done = function () { if (button) { button.disabled = false; button.textContent = label; } };
  var p;
  try { p = Promise.resolve(run()); } catch (e) { done(); return Promise.reject(e); }
  return p.then(function (v) { done(); return v; }, function (e) { done(); throw e; });
}

/** First and last day of the current month as 'YYYY-MM-DD', India time. */
export function currentMonthRange_() {
  var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
  var last = new Date(Number(p.year), Number(p.month), 0).getDate();
  return { from: p.year + '-' + p.month + '-01', to: p.year + '-' + p.month + '-' + String(last).padStart(2, '0') };
}

/** Today as 'YYYY-MM-DD' in India time (toISOString() gives UTC, which is yesterday before 05:30 IST). */
export function todayIst_() {
  var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
  return p.year + '-' + p.month + '-' + p.day;
}

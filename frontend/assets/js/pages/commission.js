/**
 * commission.js
 * The Commission tab: reports, month checkpoint, rate master, and settings.
 *
 * Four panels share one page div (the app has no URL router), so a small
 * local `showCommissionTab` swaps them. Which panels a role can even reach is
 * decided here for the UI's sake, but every one of these calls is
 * independently permission-checked on the backend — this is convenience, not
 * security.
 */
import { api } from '../api.js';
import { session } from '../session.js';
import {
  jsArg_, formatMoney_, formatDateDisplay_, formatDateTimeDisplay_,
  showToast_, statusBadge_, readFileAsBase64_, esc_
} from '../utils.js';

var ratesCache = [];
var reportsCache = [];
var pinUnlocked = false;
var pinIsSet = false;

function canEditRates_() {
  return ['Admin', 'Accounts', 'Network Manager'].indexOf(session.role) !== -1;
}
function isAdmin_() { return session.role === 'Admin'; }
function isDealer_() { return session.role === 'Dealer'; }
function canVerify_() { return ['Admin', 'Accounts'].indexOf(session.role) !== -1; }

/** YYYY-MM for last month — the month the tab defaults to, since that is what gets worked on. */
function defaultMonth_() {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ================================================================= TABS ==
export function showCommissionTab(tab) {
  ['reports', 'checkpoint', 'rates', 'settings'].forEach(function (t) {
    var panel = document.getElementById('cm-panel-' + t);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
  });
  document.querySelectorAll('#cm-tab-bar .cm-tab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'rates') loadCommissionRates();
  if (tab === 'settings') loadCommissionConfig();
}

/** Entry point from the sidebar. */
export function loadCommissionPage() {
  var isDealer = isDealer_();
  // A Dealer only ever sees its own reports — the other three panels are
  // internal tooling and their buttons are hidden outright.
  ['checkpoint', 'settings'].forEach(function (t) {
    var btn = document.querySelector('#cm-tab-bar .cm-tab[data-tab="' + t + '"]');
    if (btn) btn.style.display = isDealer ? 'none' : 'inline-block';
  });
  var settingsBtn = document.querySelector('#cm-tab-bar .cm-tab[data-tab="settings"]');
  if (settingsBtn) settingsBtn.style.display = isAdmin_() ? 'inline-block' : 'none';

  var monthEl = document.getElementById('cm-report-month');
  if (monthEl && !monthEl.value) monthEl.value = defaultMonth_();
  var cpEl = document.getElementById('cm-checkpoint-month');
  if (cpEl && !cpEl.value) cpEl.value = defaultMonth_();

  showCommissionTab('reports');
  loadCommissionReports();
}

// ============================================================== REPORTS ==
export function loadCommissionReports(allMonths) {
  var month = allMonths ? '' : (document.getElementById('cm-report-month').value || '').trim();
  api('listCommissionReports', session.token, month).then(function (rows) {
    reportsCache = rows || [];
    renderCommissionReports_();
  }).catch(function (err) { showToast_(err); });
}

function renderCommissionReports_() {
  var tbody = document.getElementById('cm-report-table-body');
  tbody.innerHTML = '';
  if (!reportsCache.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:#888;">No commission reports for this month yet.</td></tr>';
    return;
  }
  reportsCache.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc_(r.Month) + '</td>' +
      '<td>' + esc_(r['Dealer Code']) + '</td>' +
      '<td>' + esc_(r['Dealer Name']) + '</td>' +
      '<td>' + esc_(r['Frame Count']) + '</td>' +
      '<td>' + formatMoney_(r.Taxable) + '</td>' +
      '<td><strong>' + formatMoney_(r['Invoice Amount']) + '</strong></td>' +
      '<td>' + statusBadge_(r.Status) + '</td>' +
      '<td>' + agingText_(r.aging) + '</td>' +
      '<td>' + reportActions_(r) + '</td>';
    tbody.appendChild(tr);
  });
}

function agingText_(a) {
  if (!a) return '';
  var bits = [];
  if (a.pendingDays !== null && a.pendingDays !== undefined) {
    var cls = a.pendingDays > 7 ? 'badge-red' : (a.pendingDays > 3 ? 'badge-yellow' : 'badge-green');
    bits.push('<span class="badge ' + cls + '">' + a.pendingDays + 'd pending</span>');
  }
  if (a.uploadDays !== null && a.uploadDays !== undefined) bits.push('<span style="font-size:12px;color:#666;">uploaded in ' + a.uploadDays + 'd</span>');
  if (a.verifyDays !== null && a.verifyDays !== undefined) bits.push('<span style="font-size:12px;color:#666;">verified in ' + a.verifyDays + 'd</span>');
  return bits.join('<br>');
}

function reportActions_(r) {
  var id = jsArg_(r['Report ID']);
  var status = String(r.Status);
  var html = '<button class="link-btn" onclick="openCommissionDetail(' + id + ')">View</button>';

  // Breakup is always downloadable; the tax invoice only exists once the ASC
  // has been asked for one, so its button appears from that point on.
  html += ' <button class="link-btn" onclick="downloadCommissionPdf(' + id + ',\'breakup\')">Breakup PDF</button>';
  if (status !== 'Generated') {
    html += ' <button class="link-btn" onclick="downloadCommissionPdf(' + id + ',\'invoice\')">Invoice PDF</button>';
  }

  if (!isDealer_() && status === 'Generated') {
    html += ' <button class="link-btn" onclick="regenerateCommission(' + jsArg_(r['Dealer Code']) + ',' + jsArg_(r.Month) + ')">Regenerate</button>';
    html += ' <button onclick="requestCommissionInvoiceNow(' + id + ')">Request invoice</button>';
  }
  if (isDealer_() && status === 'Invoice Requested') {
    html += ' <button onclick="openCommissionInvoice(' + id + ')">Prepare invoice</button>';
    html += ' <button onclick="openCommissionUpload(' + id + ')">Upload signed copy</button>';
  }
  if (canVerify_() && status === 'Invoice Uploaded') {
    html += ' <button onclick="openCommissionVerify(' + id + ')">Verify &amp; post</button>';
  }
  if (r['Attachment Link']) {
    html += ' <a class="link-btn" href="' + esc_(r['Attachment Link']) + '" target="_blank" rel="noopener">Signed copy</a>';
  }
  return html;
}

export function openCommissionDetail(reportId) {
  api('getCommissionReportDetail', session.token, reportId).then(function (d) {
    var r = d.report;
    document.getElementById('cm-detail-title').textContent =
      'Commission ' + r.Month + ' — ' + (r['Dealer Name'] || r['Dealer Code']);
    document.getElementById('cm-detail-body').innerHTML = renderReportDetail_(r, d.lines || []);
    document.getElementById('cm-detail-card').style.display = 'block';
    document.getElementById('cm-detail-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }).catch(function (err) { showToast_(err); });
}

export function closeCommissionDetail() {
  document.getElementById('cm-detail-card').style.display = 'none';
}

function renderReportDetail_(r, lines) {
  var html = '<table><thead><tr>' +
    '<th>#</th><th>Invoice</th><th>Date</th><th>Frame no.</th><th>Model variant</th><th>Customer</th>' +
    '<th>Vehicle com</th><th>Registration</th><th>Reg com</th><th>Insurance</th><th>Ins %</th><th>Ins com</th><th>Line total</th>' +
    '</tr></thead><tbody>';
  lines.forEach(function (l, i) {
    html += '<tr><td>' + (i + 1) + '</td>' +
      '<td>' + esc_(l['Invoice No']) + '</td>' +
      '<td>' + formatDateDisplay_(l['Invoice Date']) + '</td>' +
      '<td>' + esc_(l['Frame No']) + '</td>' +
      '<td>' + esc_(l['Model Variant']) + '</td>' +
      '<td>' + esc_(l['Customer Name']) + '</td>' +
      '<td>' + formatMoney_(l['Vehicle Com']) + '</td>' +
      '<td>' + esc_(l['Registration Type']) + '</td>' +
      '<td>' + formatMoney_(l['Reg Com']) + '</td>' +
      '<td>' + formatMoney_(l['Insurance Amount']) + '</td>' +
      '<td>' + esc_(l['Ins Rate %']) + '%</td>' +
      '<td>' + formatMoney_(l['Ins Com']) + '</td>' +
      '<td>' + formatMoney_(l['Line Total']) + '</td></tr>';
  });
  html += '</tbody></table>';

  html += '<h4 style="margin-top:16px;">Totals</h4><table><tbody>';
  html += '<tr><td>Vehicle commission</td><td>' + formatMoney_(r['Vehicle Com']) + '</td></tr>';
  html += '<tr><td>Registration commission</td><td>' + formatMoney_(r['Reg Com']) + '</td></tr>';
  html += '<tr><td>Insurance commission</td><td>' + formatMoney_(r['Ins Com']) + '</td></tr>';
  html += '<tr><td><strong>Taxable</strong></td><td><strong>' + formatMoney_(r.Taxable) + '</strong></td></tr>';
  html += '<tr><td>SGST</td><td>' + formatMoney_(r.SGST) + '</td></tr>';
  html += '<tr><td>CGST</td><td>' + formatMoney_(r.CGST) + '</td></tr>';
  html += '<tr class="modal-total-row"><td>Invoice amount (rounded)</td><td>' + formatMoney_(r['Invoice Amount']) + '</td></tr>';
  html += '</tbody></table>';

  html += '<h4 style="margin-top:16px;">Progress</h4><table><tbody>';
  html += '<tr><td>Status</td><td>' + statusBadge_(r.Status) + '</td></tr>';
  html += '<tr><td>Generated</td><td>' + formatDateTimeDisplay_(r['Generated On']) + ' by ' + esc_(r['Generated By']) + '</td></tr>';
  if (r['Invoice Requested On']) html += '<tr><td>Invoice requested</td><td>' + formatDateTimeDisplay_(r['Invoice Requested On']) + ' by ' + esc_(r['Invoice Requested By']) + '</td></tr>';
  if (r['Uploaded On']) {
    html += '<tr><td>ASC invoice</td><td>' + esc_(r['ASC Invoice No']) + ' dated ' + formatDateDisplay_(r['ASC Invoice Date']) + ' — ' + formatMoney_(r['ASC Invoice Amount']) + '</td></tr>';
    html += '<tr><td>Uploaded</td><td>' + formatDateTimeDisplay_(r['Uploaded On']) + ' by ' + esc_(r['Uploaded By']) + '</td></tr>';
  }
  if (r['Verified On']) {
    html += '<tr><td>Tally entry date</td><td>' + formatDateDisplay_(r['Tally Entry Date']) + '</td></tr>';
    html += '<tr><td>Verified</td><td>' + formatDateTimeDisplay_(r['Verified On']) + ' by ' + esc_(r['Verified By']) + '</td></tr>';
    html += '<tr><td>Ledger entry</td><td>' + esc_(r['Ledger Entry ID']) + '</td></tr>';
  }
  if (r.Remarks) html += '<tr><td>Remarks</td><td>' + esc_(r.Remarks) + '</td></tr>';
  html += '</tbody></table>';
  return html;
}

export function regenerateCommission(dealerCode, month) {
  if (!window.confirm('Regenerate ' + dealerCode + ' for ' + month + '? Yeh purani report hata ke naye data se dobara banayegi.')) return;
  api('generateCommissionReport', session.token, dealerCode, month).then(function (res) {
    showToast_(null, 'Regenerated. Invoice amount: ' + formatMoney_(res.summary.invoiceAmount));
    loadCommissionReports();
  }).catch(function (err) { showToast_(err); });
}

export function requestCommissionInvoiceNow(reportId) {
  if (!window.confirm('ASC ko breakup ke saath email chala jayega aur figures lock ho jayenge. Continue?')) return;
  api('requestCommissionInvoice', session.token, reportId).then(function (res) {
    showToast_(null, 'Invoice requested. Email bhej diya: ' + (res.emailedTo || []).join(', '));
    loadCommissionReports();
  }).catch(function (err) { showToast_(err); });
}

// ------------------------------------------------------- ASC invoice ----
export function openCommissionUpload(reportId) {
  var r = findReport_(reportId);
  if (!r) { showToast_(new Error('Report not found.')); return; }
  document.getElementById('cm-upload-report-id').value = reportId;
  document.getElementById('cm-upload-title').textContent = 'Upload tax invoice — ' + r.Month;
  document.getElementById('cm-upload-hint').textContent =
    'Invoice amount exactly ' + formatMoney_(r['Invoice Amount']) + ' hona chahiye, warna upload accept nahi hoga.';
  document.getElementById('cm-upload-amount').value = r['Invoice Amount'];
  // Carry over whatever the ASC printed, so they don't retype it.
  document.getElementById('cm-upload-invoice-no').value = r['ASC Invoice No'] || '';
  document.getElementById('cm-upload-invoice-date').value = isoDateInput_(r['ASC Invoice Date']);
  document.getElementById('cm-upload-card').style.display = 'block';
  document.getElementById('cm-upload-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function closeCommissionUpload() {
  document.getElementById('cm-upload-card').style.display = 'none';
  document.getElementById('cm-upload-form').reset();
}

export function handleCommissionUpload(event) {
  event.preventDefault();
  var fileInput = document.getElementById('cm-upload-file');
  if (!fileInput.files.length) { showToast_(new Error('Tax invoice copy is mandatory.')); return; }
  var file = fileInput.files[0];
  var reportId = document.getElementById('cm-upload-report-id').value;
  var invoiceNo = document.getElementById('cm-upload-invoice-no').value;
  var invoiceDate = document.getElementById('cm-upload-invoice-date').value;
  var amount = document.getElementById('cm-upload-amount').value;

  readFileAsBase64_(file).then(function (base64) {
    return api('uploadAttachment', session.token, base64, file.name, file.type);
  }).then(function (uploaded) {
    return api('uploadCommissionInvoice', session.token, reportId, invoiceNo, invoiceDate, amount, uploaded.url);
  }).then(function () {
    showToast_(null, 'Invoice uploaded. Accounts verify karega.');
    closeCommissionUpload();
    loadCommissionReports();
  }).catch(function (err) { showToast_(err); });
}

// ------------------------------------ ASC invoice: prepare & print ----
export function openCommissionInvoice(reportId) {
  var r = findReport_(reportId);
  if (!r) { showToast_(new Error('Report not found.')); return; }
  document.getElementById('cm-invoice-report-id').value = reportId;
  document.getElementById('cm-invoice-title').textContent = 'Your tax invoice — ' + r.Month;
  document.getElementById('cm-invoice-hint').textContent =
    'Amount ' + formatMoney_(r['Invoice Amount']) + '. Invoice no. aur date daal ke print karo.';
  document.getElementById('cm-invoice-no').value = r['ASC Invoice No'] || '';
  document.getElementById('cm-invoice-date').value = isoDateInput_(r['ASC Invoice Date']);
  document.getElementById('cm-invoice-card').style.display = 'block';
  document.getElementById('cm-invoice-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function closeCommissionInvoice() {
  document.getElementById('cm-invoice-card').style.display = 'none';
}

/** Saves the number and date. Returns the promise so "Save & print" can chain onto it. */
function saveInvoiceDraft_() {
  var reportId = document.getElementById('cm-invoice-report-id').value;
  var no = document.getElementById('cm-invoice-no').value;
  var date = document.getElementById('cm-invoice-date').value;
  if (!no || !date) return Promise.reject(new Error('Invoice number aur date dono chahiye.'));
  return api('saveCommissionInvoiceDraft', session.token, reportId, no, date)
    .then(function () { return reportId; });
}

export function handleSaveCommissionInvoice(event) {
  event.preventDefault();
  saveInvoiceDraft_().then(function () {
    showToast_(null, 'Saved.');
    loadCommissionReports();
  }).catch(function (err) { showToast_(err); });
}

/**
 * Saves first, then opens the filled invoice in a new tab for printing.
 * The window is opened synchronously, before the save round-trip, because a
 * window.open() that happens inside a promise callback is treated as a popup
 * and gets blocked.
 */
export function printCommissionInvoice() {
  var win = window.open('', '_blank');
  if (!win) { showToast_(new Error('Popup blocked. Is site ke liye popups allow karo.')); return; }
  win.document.write('<p style="font-family:system-ui;padding:24px;color:#666;">Preparing your invoice…</p>');

  saveInvoiceDraft_().then(function (reportId) {
    return api('getCommissionInvoiceHtml', session.token, reportId);
  }).then(function (html) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    loadCommissionReports();
  }).catch(function (err) {
    win.close();
    showToast_(err);
  });
}

/** Downloads a PDF the backend built. kind: 'invoice' | 'breakup'. */
export function downloadCommissionPdf(reportId, kind) {
  showToast_(null, 'PDF ban raha hai…');
  api('getCommissionPdf', session.token, reportId, kind).then(function (res) {
    var bytes = atob(res.base64);
    var buf = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }).catch(function (err) { showToast_(err); });
}

function findReport_(reportId) {
  for (var i = 0; i < reportsCache.length; i++) {
    if (reportsCache[i]['Report ID'] === reportId) return reportsCache[i];
  }
  return null;
}

/** Backend dates arrive as UTC ISO strings; <input type="date"> needs the IST calendar day. */
function isoDateInput_(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  var p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
  return p.year + '-' + p.month + '-' + p.day;
}

// ------------------------------------------------------------ Verify ----
export function openCommissionVerify(reportId) {
  var r = findReport_(reportId);
  if (!r) { showToast_(new Error('Report not found.')); return; }
  document.getElementById('cm-verify-report-id').value = reportId;
  document.getElementById('cm-verify-title').textContent =
    'Verify — ' + (r['Dealer Name'] || r['Dealer Code']) + ' ' + r.Month;
  document.getElementById('cm-verify-hint').textContent =
    'Invoice ' + (r['ASC Invoice No'] || '') + ' — ' + formatMoney_(r['Invoice Amount']) +
    '. Post karne ke baad yeh month permanently lock ho jayega.';
  document.getElementById('cm-verify-card').style.display = 'block';
  document.getElementById('cm-verify-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function closeCommissionVerify() {
  document.getElementById('cm-verify-card').style.display = 'none';
  document.getElementById('cm-verify-form').reset();
}

export function handleCommissionVerify(event) {
  event.preventDefault();
  var reportId = document.getElementById('cm-verify-report-id').value;
  var tallyDate = document.getElementById('cm-verify-tally-date').value;
  var remarks = document.getElementById('cm-verify-remarks').value;
  if (!window.confirm('Confirm karne par amount ledger me post ho jayega aur yeh month lock ho jayega. Continue?')) return;
  api('verifyCommissionInvoice', session.token, reportId, tallyDate, remarks).then(function (res) {
    showToast_(null, 'Posted to ledger: ' + formatMoney_(res.amount));
    closeCommissionVerify();
    loadCommissionReports();
  }).catch(function (err) { showToast_(err); });
}

// =========================================================== CHECKPOINT ==
export function runCommissionCheckpointNow() {
  var month = (document.getElementById('cm-checkpoint-month').value || '').trim();
  api('runCommissionCheckpoint', session.token, month).then(function (rows) {
    document.getElementById('cm-checkpoint-result').innerHTML = renderCheckpoint_(rows || [], month);
  }).catch(function (err) { showToast_(err); });
}

function renderCheckpoint_(rows, month) {
  if (!rows.length) return '<p style="color:#888;">No active ASC dealers found.</p>';
  var blocked = rows.filter(function (r) { return r.missingVariants.length > 0; });
  var html = '';
  html += '<p style="margin:10px 0;">' +
    '<span class="badge badge-green">' + rows.filter(function (r) { return r.ready; }).length + ' ready</span> ' +
    '<span class="badge badge-red">' + blocked.length + ' blocked</span> ' +
    '<span class="badge badge-yellow">' + rows.filter(function (r) { return r.frameCount === 0; }).length + ' no sales</span></p>';

  html += '<table><thead><tr><th>Dealer code</th><th>Dealer name</th><th>Frames</th><th>Preview amount</th><th>Missing rates</th><th>Report</th><th>Action</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    var missing = r.missingVariants.length
      ? r.missingVariants.map(function (v) {
          return '<span class="badge badge-red">' + esc_(v) + '</span> ' +
            '<button class="link-btn" onclick="openCommissionRateForm(' + jsArg_(v) + ')">Add rate</button>';
        }).join('<br>')
      : '<span style="color:#888;">—</span>';
    var action = '';
    if (r.ready && r.canGenerate) {
      action = '<button onclick="generateOneCommission(' + jsArg_(r.dealerCode) + ',' + jsArg_(month) + ')">Generate now</button>';
    } else if (!r.canGenerate) {
      action = '<span style="color:#888; font-size:12px;">Locked (' + esc_(r.reportStatus) + ')</span>';
    }
    var warn = r.multiFrameInvoices.length
      ? '<br><span class="badge badge-yellow">' + r.multiFrameInvoices.length + ' multi-frame invoice(s)</span>'
      : '';
    html += '<tr><td>' + esc_(r.dealerCode) + '</td><td>' + esc_(r.dealerName) + '</td>' +
      '<td>' + r.frameCount + warn + '</td>' +
      '<td>' + formatMoney_(r.previewInvoiceAmount) + '</td>' +
      '<td>' + missing + '</td>' +
      '<td>' + (r.reportStatus ? statusBadge_(r.reportStatus) : '<span style="color:#888;">not generated</span>') + '</td>' +
      '<td>' + action + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

export function generateOneCommission(dealerCode, month) {
  api('generateCommissionReport', session.token, dealerCode, month).then(function (res) {
    showToast_(null, dealerCode + ' generated: ' + formatMoney_(res.summary.invoiceAmount));
    runCommissionCheckpointNow();
  }).catch(function (err) { showToast_(err); });
}

export function generateAllCommission() {
  var month = (document.getElementById('cm-checkpoint-month').value || '').trim();
  if (!window.confirm('Generate reports for every ready ASC for ' + month + '?')) return;
  api('generateAllCommissionReports', session.token, month).then(function (results) {
    var done = (results || []).filter(function (r) { return r.done; }).length;
    showToast_(null, done + ' report(s) generated.');
    runCommissionCheckpointNow();
  }).catch(function (err) { showToast_(err); });
}

// ================================================================ RATES ==
export function loadCommissionRates() {
  api('getCommissionPinStatus', session.token).then(function (s) {
    pinIsSet = s.pinSet;
    pinUnlocked = s.unlocked;
    renderPinBar_();
  }).catch(function () { /* PIN bar is cosmetic; the backend enforces regardless */ });

  api('listCommissionRates', session.token).then(function (rows) {
    ratesCache = rows || [];
    renderCommissionRates();
  }).catch(function (err) { showToast_(err); });
}

function renderPinBar_() {
  var bar = document.getElementById('cm-pin-bar');
  var addBtn = document.getElementById('cm-add-rate-btn');
  if (!bar) return;
  if (!canEditRates_()) {
    bar.innerHTML = '<span style="color:#888; font-size:12px;">View only — rate editing is for Admin, Accounts and Network Manager.</span>';
    if (addBtn) addBtn.style.display = 'none';
    return;
  }
  if (addBtn) addBtn.style.display = 'inline-block';
  if (!pinIsSet) {
    bar.innerHTML = '<span class="badge badge-yellow">No PIN set</span> ' +
      '<span style="font-size:12px; color:#666;">Admin ko Settings me jaake PIN set karna hoga, tab tak rate edit nahi hoga.</span>';
    return;
  }
  if (pinUnlocked) {
    bar.innerHTML = '<span class="badge badge-green">Unlocked</span> ' +
      '<span style="font-size:12px; color:#666;">Editing 10 minute ke liye khula hai.</span>';
    return;
  }
  bar.innerHTML = '<span class="badge badge-red">Locked</span> ' +
    '<input id="cm-pin-input" type="password" inputmode="numeric" placeholder="PIN" style="width:110px; margin:0 6px;">' +
    '<button type="button" onclick="unlockCommissionPin()">Unlock</button>';
}

export function unlockCommissionPin() {
  var pin = document.getElementById('cm-pin-input').value;
  api('verifyCommissionPin', session.token, pin).then(function (res) {
    pinUnlocked = true;
    renderPinBar_();
    showToast_(null, 'Unlocked for ' + res.minutes + ' minutes.');
  }).catch(function (err) { showToast_(err); });
}

export function renderCommissionRates() {
  var tbody = document.getElementById('cm-rate-table-body');
  if (!tbody) return;
  var q = (document.getElementById('cm-rate-search').value || '').trim().toUpperCase();
  var rows = q ? ratesCache.filter(function (r) { return String(r.modelVariant).toUpperCase().indexOf(q) !== -1; }) : ratesCache;
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">' +
      (ratesCache.length ? 'No variant matches that search.' : 'No rates yet. Add the first model with "+ Add model".') +
      '</td></tr>';
    return;
  }
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    var editBtn = canEditRates_()
      ? '<button class="link-btn" onclick="openCommissionRateForm(' + jsArg_(r.modelVariant) + ')">Edit</button>'
      : '';
    var future = r.pendingFuture ? ' <span class="badge badge-yellow">future dated</span>' : '';
    tr.innerHTML = '<td>' + esc_(r.modelVariant) + future + '</td>' +
      '<td>' + formatMoney_(r.amount) + '</td>' +
      '<td>' + formatDateDisplay_(r.effectiveFrom) + '</td>' +
      '<td>' + esc_(r.updatedBy) + '</td>' +
      '<td><button class="link-btn" onclick="showCommissionRateHistory(' + jsArg_(r.modelVariant) + ')">' + r.historyCount + ' change(s)</button></td>' +
      '<td>' + editBtn + '</td>';
    tbody.appendChild(tr);
  });
}

export function showCommissionRateHistory(modelVariant) {
  api('getCommissionRateHistory', session.token, modelVariant).then(function (rows) {
    var msg = (rows || []).map(function (r) {
      return formatDateDisplay_(r['Effective From']) + '  →  ' + formatMoney_(r['Commission Amount']) +
        '   (' + (r['Created By'] || '') + ')';
    }).join('\n');
    window.alert('Rate history — ' + modelVariant + '\n\n' + (msg || 'No history.'));
  }).catch(function (err) { showToast_(err); });
}

export function openCommissionRateForm(modelVariant) {
  if (!canEditRates_()) { showToast_(new Error('You do not have permission to edit rates.')); return; }
  var existing = null;
  for (var i = 0; i < ratesCache.length; i++) {
    if (String(ratesCache[i].modelVariant).toUpperCase() === String(modelVariant || '').toUpperCase()) { existing = ratesCache[i]; break; }
  }
  document.getElementById('cm-rate-form-title').textContent = existing ? ('Change rate — ' + existing.modelVariant) : 'Add model';
  document.getElementById('cm-rate-variant').value = modelVariant || '';
  document.getElementById('cm-rate-amount').value = existing ? existing.amount : '';
  document.getElementById('cm-rate-effective').value = new Date().toISOString().slice(0, 10);
  document.getElementById('cm-rate-form-card').style.display = 'block';
  // The checkpoint's "Add rate" buttons live on a different panel, so jump the
  // user to the rates panel rather than opening a form they cannot see.
  showCommissionTab('rates');
  document.getElementById('cm-rate-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function closeCommissionRateForm() {
  document.getElementById('cm-rate-form-card').style.display = 'none';
  document.getElementById('cm-rate-form').reset();
}

export function handleSaveCommissionRate(event) {
  event.preventDefault();
  var variant = document.getElementById('cm-rate-variant').value;
  var amount = document.getElementById('cm-rate-amount').value;
  var effective = document.getElementById('cm-rate-effective').value;
  api('saveCommissionRate', session.token, variant, amount, effective).then(function (res) {
    showToast_(null, res.isNew ? ('Added ' + res.modelVariant) : ('Rate updated for ' + res.modelVariant));
    closeCommissionRateForm();
    loadCommissionRates();
  }).catch(function (err) { showToast_(err); });
}

// ============================================================= SETTINGS ==
export function loadCommissionConfig() {
  api('listCommissionConfig', session.token).then(function (rows) {
    var tbody = document.getElementById('cm-config-table-body');
    tbody.innerHTML = '';
    var labels = {
      REGISTRATION_COMMISSION: 'Registration commission (\u20b9, Permanent Registration only)',
      INSURANCE_COMMISSION_PCT: 'Insurance commission (% of premium \u00f7 1.18)',
      SGST_PCT: 'SGST (%)',
      CGST_PCT: 'CGST (%)'
    };
    (rows || []).forEach(function (c) {
      var overrides = (c.overrides || []).length
        ? c.overrides.map(function (o) { return esc_(o.scope) + ': <strong>' + esc_(o.value) + '</strong>'; }).join('<br>')
        : '<span style="color:#888;">none</span>';
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc_(labels[c.key] || c.key) + '</td>' +
        '<td><strong>' + (c.defaultValue === null ? '<span style="color:#888;">not set</span>' : esc_(c.defaultValue)) + '</strong></td>' +
        '<td>' + overrides + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleSaveCommissionConfig(event) {
  event.preventDefault();
  var key = document.getElementById('cm-config-key').value;
  var scope = document.getElementById('cm-config-scope').value;
  var value = document.getElementById('cm-config-value').value;
  var effective = document.getElementById('cm-config-effective').value;
  api('setCommissionConfig', session.token, key, scope, value, effective).then(function () {
    showToast_(null, 'Setting saved.');
    document.getElementById('cm-config-form').reset();
    loadCommissionConfig();
  }).catch(function (err) { showToast_(err); });
}

export function handleSetCommissionPin(event) {
  event.preventDefault();
  var pin = document.getElementById('cm-pin-new').value;
  var confirmPin = document.getElementById('cm-pin-confirm').value;
  if (pin !== confirmPin) { showToast_(new Error('Dono PIN same nahi hain.')); return; }
  api('setCommissionPin', session.token, pin).then(function () {
    showToast_(null, 'Commission PIN set.');
    document.getElementById('cm-pin-set-form').reset();
  }).catch(function (err) { showToast_(err); });
}

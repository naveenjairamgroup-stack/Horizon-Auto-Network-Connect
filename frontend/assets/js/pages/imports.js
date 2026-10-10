/**
 * imports.js — upload DMS exports from the portal, see how current each
 * data set is, and the history of uploads (refused ones with their reason).
 */
import { api } from '../api.js';
import { session } from '../session.js';
import { showToast_, formatDateTimeDisplay_, formatDateDisplay_, esc_, readFileAsBase64_, withBusy_ } from '../utils.js';
import { loadDashboardSummary } from './dashboard.js';
import { refreshSidebarCounts } from '../sidebar.js';

var statusCache = [];

export function loadImportLog() {
  loadImportStatus_();
  loadImportHistory_();
  api('getImportLog', session.token).then(function (rows) {
    var tbody = document.getElementById('import-log-table-body');
    tbody.innerHTML = '';
    (rows || []).slice(0, 100).forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + formatDateTimeDisplay_(r['Upload Time']) + '</td>' +
        '<td>' + esc_(r['Folder Type']) + '</td><td>' + esc_(r['File Name']) + '</td>' +
        '<td>' + esc_(r['Records Processed']) + '</td><td>' + esc_(r['Duplicates Skipped']) + '</td>' +
        '<td>' + esc_(r['Updated Count'] || 0) + '</td>' +
        '<td>' + esc_(r['Reversed Count'] || 0) + '</td><td>' + esc_(r.Status) + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

function loadImportStatus_() {
  api('getImportStatus', session.token).then(function (rows) {
    statusCache = rows || [];
    var tbody = document.getElementById('imp-status-body');
    tbody.innerHTML = statusCache.map(function (s) {
      var till = s.dataTill
        ? '<strong>' + formatDateDisplay_(s.dataTill) + '</strong>' + (s.isSnapshot ? ' <span class="muted">(stock as on upload day)</span>' : '')
        : '<span class="muted">not uploaded yet</span>';
      return '<tr><td>' + esc_(s.label) + '</td><td>' + till + '</td>' +
        '<td>' + formatDateTimeDisplay_(s.lastUploadOn) + '</td><td>' + esc_(s.lastUploadBy) + '</td>' +
        '<td>' + esc_(s.lastFileName) + '</td></tr>';
    }).join('');
    onImportTypeChange();
  }).catch(function (err) { showToast_(err); });
}

function loadImportHistory_() {
  api('listImportUploads', session.token).then(function (rows) {
    var tbody = document.getElementById('imp-history-body');
    if (!rows || !rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No uploads yet.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function (r) {
      var status = r.Status === 'Success' ? '<span class="badge badge-green">Imported</span>'
        : '<span class="badge badge-red">Refused</span>';
      var err = r.Status === 'Success' ? '' : '<div class="muted" style="max-width:420px;">' + esc_(r.Error) + '</div>';
      return '<tr><td>' + formatDateTimeDisplay_(r['Uploaded On']) + '<div class="muted">' + esc_(r['Uploaded By']) + '</div></td>' +
        '<td>' + esc_(r.label) + '</td><td>' + esc_(r['File Name']) + err + '</td>' +
        '<td>' + formatDateDisplay_(r['Data Till']) + '</td>' +
        '<td>' + esc_(r.Processed) + '</td><td>' + esc_(r.Skipped) + '</td>' +
        '<td>' + esc_(r.Updated) + '</td><td>' + esc_(r.Reversed) + '</td><td>' + status + '</td></tr>';
    }).join('');
  }).catch(function (err) { showToast_(err); });
}

export function onImportTypeChange() {
  var type = document.getElementById('imp-type').value;
  var box = document.getElementById('imp-required');
  var s = statusCache.filter(function (x) { return x.type === type; })[0];
  box.innerHTML = s ? 'Required columns: <strong>' + s.required.map(esc_).join(', ') + '</strong>' : '';
}

export function handleImportUpload(button) {
  var type = document.getElementById('imp-type').value;
  var input = document.getElementById('imp-file');
  var out = document.getElementById('imp-result');
  out.innerHTML = '';
  if (!type) { showToast_(new Error('Choose the file type first.')); return; }
  if (!input.files.length) { showToast_(new Error('Choose the CSV file.')); return; }
  var file = input.files[0];

  withBusy_(button, function () {
    out.innerHTML = '<p class="muted">Uploading and importing ' + esc_(file.name) + ' — large files can take a minute or two. Keep this page open.</p>';
    return readFileAsBase64_(file).then(function (base64) {
      return api('uploadImportFile', session.token, type, file.name, base64);
    }).then(function (r) {
      out.innerHTML = '<div class="import-ok"><strong>' + esc_(r.label) + ' imported.</strong> ' +
        r.rows + ' row(s) read' + (r.ignoredRows ? ' (' + r.ignoredRows + ' blank/summary row(s) ignored)' : '') + '. ' +
        'New: ' + r.processed + ' · Already there / not ours: ' + r.skipped +
        ' · Updated: ' + r.updated + ' · Reversed: ' + r.reversed +
        '<br>Data till: <strong>' + formatDateDisplay_(r.dataTill) + '</strong></div>';
      input.value = '';
      loadImportLog();
      loadDashboardSummary();
      refreshSidebarCounts();
    });
  }).catch(function (err) {
    out.innerHTML = '<div class="import-error"><strong>File not imported.</strong>\n' + esc_(err.message || err) + '</div>';
    loadImportHistory_();
  });
}

/** Kept so older bookmarks/handlers don't break; the Drive import is switched off. */
export function handleImportNow() {
  showToast_(new Error('Drive import is switched off — upload the file above instead.'));
}

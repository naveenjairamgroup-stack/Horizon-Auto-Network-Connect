import { api } from '../api.js';
import { session } from '../session.js';
import { showToast_ } from '../utils.js';
import { loadDashboardSummary } from './dashboard.js';

export function loadImportLog() {
  api('getImportLog', session.token).then(function (rows) {
    var tbody = document.getElementById('import-log-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r['Upload Time'] + '</td><td>' + (r['Folder Type'] || '') + '</td><td>' + r['File Name'] + '</td>' +
        '<td>' + r['Records Processed'] + '</td><td>' + r['Duplicates Skipped'] + '</td><td>' + (r['Updated Count'] || 0) + '</td>' +
        '<td>' + (r['Reversed Count'] || 0) + '</td><td>' + r.Status + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleImportNow() {
  document.getElementById('import-now-result').textContent = 'Running... yeh 1-2 minute le sakta hai.';
  api('runImportNow', session.token).then(function (results) {
    document.getElementById('import-now-result').textContent = 'Ho gaya: ' + JSON.stringify(results);
    loadImportLog();
    loadDashboardSummary();
  }).catch(function (err) { showToast_(err); });
}

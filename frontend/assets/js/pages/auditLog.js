import { api } from '../api.js';
import { session } from '../session.js';
import { showToast_, formatDateTimeDisplay_, esc_ } from '../utils.js';

export function loadAuditLog() {
  api('getAuditLog', session.token).then(function (rows) {
    var tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '';
    (rows || []).slice(0, 200).forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + formatDateTimeDisplay_(r.Timestamp) + '</td>' +
        '<td>' + esc_(r.User) + '</td><td>' + esc_(r.Action) + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

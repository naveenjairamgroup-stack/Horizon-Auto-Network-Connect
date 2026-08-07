import { api } from '../api.js';
import { session } from '../session.js';
import { showToast_ } from '../utils.js';

export function loadAuditLog() {
  api('getAuditLog', session.token).then(function (rows) {
    var tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '';
    (rows || []).slice(0, 200).forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r.Timestamp + '</td><td>' + r.User + '</td><td>' + r.Action + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

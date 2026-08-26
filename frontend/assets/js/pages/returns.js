import { api } from '../api.js';
import { session } from '../session.js';
import { formatMoney_, statusBadge_, showToast_, readFileAsBase64_, esc_ } from '../utils.js';
import { loadDashboardSummary } from './dashboard.js';

var frameInputCount = 1;

export function onReturnTypeChange() {
  var type = document.getElementById('ret-type').value;
  document.getElementById('ret-vehicle-block').style.display = type === 'Vehicle' ? 'block' : 'none';
  document.getElementById('ret-parts-block').style.display = type === 'Parts' ? 'block' : 'none';
}

export function addFrameNumberInput() {
  frameInputCount++;
  var div = document.createElement('div');
  div.className = 'frame-row';
  div.innerHTML = '<input class="ret-frame-input" placeholder="Frame no. ' + frameInputCount + '">' +
    '<button type="button" class="frame-remove-btn" title="Remove" onclick="removeFrameNumberInput(this)">&times;</button>';
  document.getElementById('ret-frame-list').appendChild(div);
}

export function removeFrameNumberInput(button) {
  button.closest('.frame-row').remove();
}

export function handleSubmitReturn(event) {
  event.preventDefault();
  var fileInput = document.getElementById('ret-attachment');
  if (!fileInput.files.length) { showToast_(new Error('Tax invoice copy is mandatory.')); return; }
  var file = fileInput.files[0];

  readFileAsBase64_(file).then(function (base64) {
    return api('uploadAttachment', session.token, base64, file.name, file.type);
  }).then(function (uploaded) {
    var type = document.getElementById('ret-type').value;
    var frameNumbers = Array.prototype.slice.call(document.querySelectorAll('.ret-frame-input'))
      .map(function (i) { return i.value.trim(); }).filter(Boolean).join(', ');
    var ret = {
      'Dealer Code':      document.getElementById('ret-dealer-code').value,
      'Return Type':      type,
      'Invoice No':       document.getElementById('ret-invoice-no').value,
      'Invoice Date':     document.getElementById('ret-invoice-date').value,
      'Frame Numbers':    type === 'Vehicle' ? frameNumbers : '',
      'Part Description': type === 'Parts' ? document.getElementById('ret-part-desc').value : '',
      'Total Amount':     document.getElementById('ret-amount').value,
      'Attachment Link':  uploaded.url
    };
    return api('submitReturn', session.token, ret);
  }).then(function () {
    showToast_(null, 'Return submitted for approval.');
    document.getElementById('new-return-form').reset();
    loadReturns();
  }).catch(function (err) { showToast_(err); });
}

export function loadReturns() {
  api('listReturns', session.token).then(function (rows) {
    var tbody = document.getElementById('return-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      var actionHtml = '';
      if (r['Approval Status'] === 'Pending' && (session.role === 'Network Manager' || session.role === 'Admin')) {
        actionHtml = '<button onclick="handleApproveReturn(\'' + r['Return ID'] + '\')">Approve</button> ' +
                     '<button onclick="handleRejectReturn(\'' + r['Return ID'] + '\')">Reject</button>';
      }
      var lateTag = String(r['Late Entry']) === 'true' ? ' <span class="badge badge-yellow">Late entry</span>' : '';
      tr.innerHTML = '<td>' + esc_(r['Dealer Code']) + '</td><td>' + esc_(r['Dealer Name']) + '</td>' +
        '<td>' + esc_(r['Return Type']) + '</td><td>' + esc_(r['Invoice No']) + lateTag + '</td>' +
        '<td>' + formatMoney_(r['Total Amount']) + '</td><td>' + statusBadge_(r['Approval Status']) + '</td><td>' + actionHtml + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleApproveReturn(id) {
  api('approveReturn', session.token, id).then(function () {
    showToast_(null, 'Return approved and posted to ledger.');
    loadReturns();
    loadDashboardSummary();
  }).catch(function (err) { showToast_(err); });
}

export function handleRejectReturn(id) {
  var reason = window.prompt('Reason for rejection (optional):') || '';
  api('rejectReturn', session.token, id, reason).then(function () {
    showToast_(null, 'Return rejected.');
    loadReturns();
    loadDashboardSummary();
  }).catch(function (err) { showToast_(err); });
}

import { api } from '../api.js';
import { session } from '../session.js';
import { formatMoney_, statusBadge_, showToast_ } from '../utils.js';
import { loadDashboardSummary } from './dashboard.js';

export function loadPayments() {
  api('listPayments', session.token).then(function (rows) {
    var tbody = document.getElementById('payment-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (p) {
      var tr = document.createElement('tr');
      var actionHtml = '';
      if (p['Approval Status'] === 'Pending' && (session.role === 'Accounts' || session.role === 'Admin')) {
        actionHtml = '<button onclick="handleApprovePayment(\'' + p['Payment ID'] + '\')">Approve</button> ' +
                     '<button onclick="handleRejectPayment(\'' + p['Payment ID'] + '\')">Reject</button>';
      }
      tr.innerHTML = '<td>' + p['Dealer Code'] + '</td><td>' + p.Mode + '</td><td>' + formatMoney_(p.Amount) + '</td>' +
        '<td>' + p.Date + '</td><td>' + statusBadge_(p['Approval Status']) + '</td><td>' + actionHtml + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleSubmitPayment(event) {
  event.preventDefault();
  var payment = {
    'Dealer Code':   document.getElementById('pay-dealer-code').value,
    'Mode':          document.getElementById('pay-mode').value,
    'Amount':        document.getElementById('pay-amount').value,
    'Date':          document.getElementById('pay-date').value,
    'Reference No':  document.getElementById('pay-reference').value,
    'Remarks':       document.getElementById('pay-remarks').value
  };
  api('submitPayment', session.token, payment).then(function () {
    showToast_(null, 'Payment submitted for approval.');
    document.getElementById('new-payment-form').reset();
    loadPayments();
  }).catch(function (err) { showToast_(err); });
}

export function handleApprovePayment(id) {
  api('approvePayment', session.token, id).then(function () {
    showToast_(null, 'Payment approved and posted to ledger.');
    loadPayments();
    loadDashboardSummary();
  }).catch(function (err) { showToast_(err); });
}

export function handleRejectPayment(id) {
  var reason = window.prompt('Reason for rejection (optional):') || '';
  api('rejectPayment', session.token, id, reason).then(function () {
    showToast_(null, 'Payment rejected.');
    loadPayments();
    loadDashboardSummary();
  }).catch(function (err) { showToast_(err); });
}

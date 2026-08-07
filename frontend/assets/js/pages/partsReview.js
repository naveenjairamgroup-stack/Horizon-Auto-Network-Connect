import { api } from '../api.js';
import { session } from '../session.js';
import { jsArg_, formatMoney_, formatDateDisplay_, statusBadge_, showToast_ } from '../utils.js';
import { loadDashboardSummary } from './dashboard.js';

export function loadPartsSaleReviewQueue() {
  api('listPartsSaleReviewQueue', session.token).then(function (rows) {
    var tbody = document.getElementById('psr-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      var actionHtml = r.Status === 'Pending'
        ? '<button onclick="handleAssignPartsSale(' + jsArg_(r['Queue ID']) + ', ' + jsArg_(r['Suggested Dealer Code']) + ')">Assign to ' + r['Suggested Dealer Code'] + '</button>'
        : '';
      tr.innerHTML = '<td>' + r['Invoice No'] + '</td><td>' + formatDateDisplay_(r['Invoice Date']) + '</td><td>' + (r['Account Name'] || '') + '</td>' +
        '<td>' + (r['Account GSTIN'] || '-') + '</td><td>' + formatMoney_(r['Total Invoice Value']) + '</td>' +
        '<td>' + (r['Suggested Dealer Code'] || '') + '</td><td>' + statusBadge_(r.Status) + '</td><td>' + actionHtml + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleAssignPartsSale(queueId, suggestedDealerCode) {
  var dealerCode = window.prompt('Kis Dealer Code ko assign karna hai?', suggestedDealerCode || '');
  if (!dealerCode) return;
  api('assignPartsSaleReview', session.token, queueId, dealerCode).then(function () {
    showToast_(null, 'Assigned and posted to ledger.');
    loadPartsSaleReviewQueue();
    loadDashboardSummary();
  }).catch(function (err) { showToast_(err); });
}

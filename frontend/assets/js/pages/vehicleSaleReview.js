import { api } from '../api.js';
import { refreshSidebarCounts } from '../sidebar.js';
import { session } from '../session.js';
import { formatMoney_, statusBadge_, showToast_, esc_ } from '../utils.js';
import { loadDashboardSummary } from './dashboard.js';

var vsrCurrentQueueId = null;

export function loadVehicleSaleReviews() {
  api('listVehicleSaleReviews', session.token).then(function (rows) {
    var tbody = document.getElementById('vsr-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      var actionHtml = '';
      if (r.Status === 'Pending') {
        actionHtml = '<button onclick="openVehicleSaleReviewForm(\'' + r['Queue ID'] + '\')">Fill form</button>';
      } else if (r.Status === 'Submitted') {
        var canEdit = (session.role === 'Admin' || session.role === 'Accounts') ||
          (session.username === r['Submitted By'] && (new Date() - new Date(r['Submitted On'])) / 60000 <= 60);
        actionHtml = canEdit ? '<button onclick="openVehicleSaleReviewForm(\'' + r['Queue ID'] + '\')">Edit</button>' : '<span style="color:#888; font-size:12px;">Locked</span>';
      }
      tr.innerHTML = '<td>' + esc_(r['Dealer Code']) + '</td><td>' + esc_(r['Dealer Name']) + '</td>' +
        '<td>' + esc_(r['Invoice No']) + '</td><td>' + esc_(r['Customer Name']) + '</td>' +
        '<td>' + esc_(r['Model Info']) + '</td><td>' + esc_(r['Purchase Type']) + '</td>' +
        '<td>' + statusBadge_(r.Status) + '</td><td>' + actionHtml + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function openVehicleSaleReviewForm(queueId) {
  api('listVehicleSaleReviews', session.token).then(function (rows) {
    var row = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i]['Queue ID'] === queueId) { row = rows[i]; break; } }
    if (!row) { showToast_(new Error('Not found.')); return; }
    vsrCurrentQueueId = queueId;

    document.getElementById('vsr-form-title').textContent = (row.Status === 'Pending' ? 'Review' : 'Edit') + ' invoice ' + row['Invoice No'];
    document.getElementById('vsr-frames').value = row['Frame Numbers'] || '';
    document.getElementById('vsr-raw-total').value = formatMoney_(row['Total Invoice Amount']);
    document.getElementById('vsr-purchase-type').value = row['Purchase Type'] || '';
    document.getElementById('vsr-financier').value = row['Financier'] || '';
    document.getElementById('vsr-hypothecation').value = row['Hypothecation'] || '';
    document.getElementById('vsr-finance-amount').value = row['Finance Amount'] || '';
    var isFinance = String(row['Purchase Type']).toLowerCase() === 'finance';
    document.getElementById('vsr-finance-block').style.display = isFinance ? 'flex' : 'none';

    document.querySelectorAll('input[name="vsr-reg-type"]').forEach(function (el) { el.checked = (el.value === row['Registration Type']); });
    document.getElementById('vsr-reg-amount').value = row['Registration Amount'] || '';
    document.querySelectorAll('input[name="vsr-ins-type"]').forEach(function (el) { el.checked = (el.value === (row['Insurance Type'] || 'Amount')); });
    document.getElementById('vsr-ins-amount').value = row['Insurance Amount'] || '';
    document.querySelectorAll('input[name="vsr-ew-type"]').forEach(function (el) { el.checked = (el.value === (row['EW Type'] || 'Amount')); });
    document.getElementById('vsr-ew-amount').value = row['EW Amount'] || '';
    document.getElementById('vsr-hpa-amount').value = row['HPA Amount'] || '';

    onRegistrationTypeChange();
    onInsuranceTypeChange();
    onEwTypeChange();
    document.getElementById('vsr-form-card').style.display = 'block';
  }).catch(function (err) { showToast_(err); });
}

export function closeVehicleSaleReviewForm() {
  document.getElementById('vsr-form-card').style.display = 'none';
  document.getElementById('vsr-form').reset();
  vsrCurrentQueueId = null;
}

export function onRegistrationTypeChange() {
  var selected = document.querySelector('input[name="vsr-reg-type"]:checked');
  var value = selected ? selected.value : '';
  var disabled = value === 'TR Only' || value === 'No Registration';
  document.getElementById('vsr-hpa-row').style.display = disabled ? 'none' : 'flex';
  if (disabled) document.getElementById('vsr-hpa-amount').value = '';
}

export function onInsuranceTypeChange() {
  var selected = document.querySelector('input[name="vsr-ins-type"]:checked');
  var isOutside = selected && selected.value === 'Insurance from Outside';
  document.getElementById('vsr-ins-amount').disabled = isOutside;
  if (isOutside) document.getElementById('vsr-ins-amount').value = 0;
}

export function onEwTypeChange() {
  var selected = document.querySelector('input[name="vsr-ew-type"]:checked');
  var isNoEw = selected && selected.value === 'No EW';
  document.getElementById('vsr-ew-amount').disabled = isNoEw;
  if (isNoEw) document.getElementById('vsr-ew-amount').value = 0;
}

export function handleSubmitVehicleSaleReview(event) {
  event.preventDefault();
  var regRadio = document.querySelector('input[name="vsr-reg-type"]:checked');
  if (!regRadio) { showToast_(new Error('Registration option chuno.')); return; }
  var insRadio = document.querySelector('input[name="vsr-ins-type"]:checked');
  var ewRadio = document.querySelector('input[name="vsr-ew-type"]:checked');

  var formData = {
    registrationType: regRadio.value,
    registrationAmount: document.getElementById('vsr-reg-amount').value,
    insuranceType: insRadio ? insRadio.value : 'Amount',
    insuranceAmount: document.getElementById('vsr-ins-amount').value,
    ewType: ewRadio ? ewRadio.value : 'Amount',
    ewAmount: document.getElementById('vsr-ew-amount').value,
    hpaAmount: document.getElementById('vsr-hpa-amount').value,
    financierOverride: document.getElementById('vsr-financier').value,
    financeAmountOverride: document.getElementById('vsr-finance-amount').value
  };

  api('submitVehicleSaleReview', session.token, vsrCurrentQueueId, formData).then(function () {
    showToast_(null, 'Posted to ledger.');
    closeVehicleSaleReviewForm();
    loadVehicleSaleReviews();
    loadDashboardSummary();
    refreshSidebarCounts();
  }).catch(function (err) { showToast_(err); });
}

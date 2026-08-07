import { api } from '../api.js';
import { session } from '../session.js';
import { formatMoney_, showToast_ } from '../utils.js';

export function loadCommissionRules() {
  api('listCommissionRules', session.token).catch(function (err) { showToast_(err); });
}

export function handleAddCommissionRule(event) {
  event.preventDefault();
  var rule = {
    'Vehicle Model':    document.getElementById('cr-model').value,
    'Commission Type':  document.getElementById('cr-type').value,
    'Rate':             document.getElementById('cr-rate').value,
    'Effective Date':   document.getElementById('cr-effective').value
  };
  api('addCommissionRule', session.token, rule).then(function () {
    showToast_(null, 'Commission rule added.');
    document.getElementById('new-commission-rule-form').reset();
  }).catch(function (err) { showToast_(err); });
}

export function handleCalculateCommission(event) {
  event.preventDefault();
  var dealerCode = document.getElementById('cc-dealer-code').value;
  var month = document.getElementById('cc-month').value;
  api('calculateCommission', session.token, dealerCode, month).then(function (result) {
    showToast_(null, 'Commission calculated: ' + formatMoney_(result.amount) + ' for ' + result.retailCount + ' retail(s).');
    document.getElementById('calc-commission-form').reset();
    loadCommissionEntries(dealerCode);
  }).catch(function (err) { showToast_(err); });
}

export function loadCommissionEntries(dealerCode) {
  api('listCommissionEntries', session.token, dealerCode).then(function (rows) {
    var tbody = document.getElementById('commission-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (c) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + c['Dealer Code'] + '</td><td>' + c.Month + '</td><td>' + c['Retail Count'] + '</td><td>' + formatMoney_(c.Amount) + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

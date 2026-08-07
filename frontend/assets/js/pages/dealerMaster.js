import { api } from '../api.js';
import { session } from '../session.js';
import { jsArg_, formatMoney_, showToast_ } from '../utils.js';

export function loadDealers() {
  api('listDealers', session.token).then(function (dealers) {
    var tbody = document.getElementById('dealer-table-body');
    tbody.innerHTML = '';
    (dealers || []).forEach(function (d) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + d['Dealer Code'] + '</td><td>' + d['Dealer Name'] + '</td><td>' + d.Type + '</td>' +
        '<td>' + (d.Region || '') + '</td><td>' + formatMoney_(d['Credit Limit']) + '</td><td>' + d.Status + '</td>' +
        '<td>' + (d['Vehicle Sale Alias'] || '<span style="color:#bbb;">not set</span>') + '</td>' +
        '<td>' + (d['Inventory Location Alias'] || '<span style="color:#bbb;">not set</span>') + '</td>' +
        '<td><button class="link-btn" onclick="handleEditVehicleSaleAlias(' + jsArg_(d['Dealer Code']) + ', ' + jsArg_(d['Vehicle Sale Alias'] || '') + ')">Edit VS alias</button> ' +
        '<button class="link-btn" onclick="handleEditInventoryAlias(' + jsArg_(d['Dealer Code']) + ', ' + jsArg_(d['Inventory Location Alias'] || '') + ')">Edit Inv alias</button></td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleEditVehicleSaleAlias(dealerCode, current) {
  var value = window.prompt('Vehicle Sale Alias for ' + dealerCode + ' (exact "Assigned To (DSE) Name" from Vehicle_Sale reports):', current || '');
  if (value === null) return;
  api('updateDealer', session.token, dealerCode, { 'Vehicle Sale Alias': value }).then(function () {
    showToast_(null, 'Updated.');
    loadDealers();
  }).catch(function (err) { showToast_(err); });
}

export function handleEditInventoryAlias(dealerCode, current) {
  var value = window.prompt('Inventory Location Alias for ' + dealerCode + ' (exact "Inventory Location" from Stock reports):', current || '');
  if (value === null) return;
  api('updateDealer', session.token, dealerCode, { 'Inventory Location Alias': value }).then(function () {
    showToast_(null, 'Updated.');
    loadDealers();
  }).catch(function (err) { showToast_(err); });
}

export function handleCreateDealer(event) {
  event.preventDefault();
  var dealer = {
    'Dealer Code':   document.getElementById('nd-code').value,
    'Dealer Name':   document.getElementById('nd-name').value,
    'Type':          document.getElementById('nd-type').value,
    'Region':        document.getElementById('nd-region').value,
    'Credit Limit':  document.getElementById('nd-limit').value,
    'Mobile':        document.getElementById('nd-mobile').value,
    'Email':         document.getElementById('nd-email').value,
    'GST':           document.getElementById('nd-gst').value,
    'Vehicle Sale Alias': document.getElementById('nd-vsalias').value,
    'Inventory Location Alias': document.getElementById('nd-invalias').value
  };
  api('createDealer', session.token, dealer).then(function () {
    showToast_(null, 'Dealer created.');
    document.getElementById('new-dealer-form').reset();
    loadDealers();
  }).catch(function (err) { showToast_(err); });
}

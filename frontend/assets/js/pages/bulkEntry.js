/**
 * bulkEntry.js — post Interest / Commission to many dealers in one go.
 * Validation is all-or-nothing on the backend; this screen only collects rows.
 */
import { api } from '../api.js';
import { session } from '../session.js';
import { formatMoney_, showToast_, esc_, withBusy_, todayIst_ } from '../utils.js';
import { getDealers_ } from '../dealers.js';

var dealerOptionsHtml = '';

export function loadBulkEntry() {
  var d = document.getElementById('bulk-date');
  if (!d.value) d.value = todayIst_();
  getDealers_().then(function (dealers) {
    dealerOptionsHtml = '<option value="">— choose dealer —</option>' + dealers.map(function (x) {
      return '<option value="' + esc_(x['Dealer Code']) + '">' + esc_(x['Dealer Name']) + ' — ' + esc_(x['Dealer Code']) + '</option>';
    }).join('');
    if (!document.querySelectorAll('#bulk-rows tr').length) addBulkRow();
    else document.querySelectorAll('.bulk-dealer').forEach(function (s) { var v = s.value; s.innerHTML = dealerOptionsHtml; s.value = v; });
  }).catch(function (err) { showToast_(err); });
}

export function onBulkHeadChange() { document.getElementById('bulk-result').innerHTML = ''; }

export function addBulkRow(code) {
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td><select class="bulk-dealer" onchange="updateBulkTotal()">' + dealerOptionsHtml + '</select></td>' +
    '<td><input class="bulk-amount" type="number" step="0.01" min="0" oninput="updateBulkTotal()"></td>' +
    '<td><input class="bulk-invoice"></td>' +
    '<td><input class="bulk-row-remarks"></td>' +
    '<td><button type="button" class="link-btn" onclick="removeBulkRow(this)">Remove</button></td>';
  document.getElementById('bulk-rows').appendChild(tr);
  if (code) tr.querySelector('.bulk-dealer').value = code;
  updateBulkTotal();
}

export function removeBulkRow(btn) {
  btn.closest('tr').remove();
  updateBulkTotal();
}

export function addAllBulkDealers() {
  var have = {};
  document.querySelectorAll('.bulk-dealer').forEach(function (s) { if (s.value) have[s.value] = true; });
  // Drop empty starter rows before adding everyone.
  document.querySelectorAll('#bulk-rows tr').forEach(function (tr) {
    if (!tr.querySelector('.bulk-dealer').value && !tr.querySelector('.bulk-amount').value) tr.remove();
  });
  getDealers_().then(function (dealers) {
    dealers.forEach(function (d) { if (!have[d['Dealer Code']]) addBulkRow(d['Dealer Code']); });
  });
}

export function clearBulkRows() {
  if (!window.confirm('Clear all rows?')) return;
  document.getElementById('bulk-rows').innerHTML = '';
  document.getElementById('bulk-result').innerHTML = '';
  addBulkRow();
}

export function updateBulkTotal() {
  var total = 0, n = 0;
  document.querySelectorAll('#bulk-rows tr').forEach(function (tr) {
    var a = Number(tr.querySelector('.bulk-amount').value) || 0;
    if (a > 0 && tr.querySelector('.bulk-dealer').value) { total += a; n++; }
  });
  document.getElementById('bulk-total').textContent = formatMoney_(total);
  document.getElementById('bulk-count').textContent = n + ' dealer(s) with an amount';
}

export function postBulkEntries(button) {
  var head = document.getElementById('bulk-head').value;
  var date = document.getElementById('bulk-date').value;
  var remarks = document.getElementById('bulk-remarks').value;
  var entries = [];
  document.querySelectorAll('#bulk-rows tr').forEach(function (tr) {
    var code = tr.querySelector('.bulk-dealer').value;
    var amount = tr.querySelector('.bulk-amount').value;
    if (!code && !amount) return; // fully blank row — ignore
    entries.push({
      dealerCode: code, amount: amount,
      invoiceNo: tr.querySelector('.bulk-invoice').value,
      remarks: tr.querySelector('.bulk-row-remarks').value
    });
  });
  var out = document.getElementById('bulk-result');
  if (!entries.length) { showToast_(new Error('Add at least one dealer with an amount.')); return; }
  if (!date) { showToast_(new Error('Choose the entry date.')); return; }
  var total = entries.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
  if (!window.confirm('Post ' + head + ' to ' + entries.length + ' dealer(s), total ' + formatMoney_(total) + '?')) return;

  withBusy_(button, function () {
    return api('postBulkLedgerEntries', session.token, head, date, entries, remarks).then(function (res) {
      if (res.errors && res.errors.length) {
        out.innerHTML = '<div class="import-error"><strong>Nothing was posted.</strong> Fix these and post again:\n\n' +
          res.errors.map(esc_).join('\n') + '</div>';
        return;
      }
      out.innerHTML = '<div class="import-ok">Posted ' + res.posted + ' ' + esc_(head) + ' entr' + (res.posted > 1 ? 'ies' : 'y') +
        ' (' + esc_(res.side) + '), total ' + formatMoney_(res.total) + '.</div>';
      document.getElementById('bulk-rows').innerHTML = '';
      addBulkRow();
    });
  }).catch(function (err) { showToast_(err); });
}

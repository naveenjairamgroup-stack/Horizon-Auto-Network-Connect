import { api } from '../api.js';
import { session } from '../session.js';
import { jsArg_, formatMoney_, formatDateDisplay_, showToast_ } from '../utils.js';

export function loadDealerDropdowns() {
  api('listDealers', session.token).then(function (dealers) {
    var select = document.getElementById('ledger-dealer-select');
    select.innerHTML = '';
    (dealers || []).forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d['Dealer Code'];
      opt.textContent = d['Dealer Code'] + ' \u2014 ' + d['Dealer Name'];
      select.appendChild(opt);
    });
    if (dealers && dealers.length) loadLedger(dealers[0]['Dealer Code']);
  }).catch(function (err) { showToast_(err); });
}

export function onLedgerDealerChange() {
  loadLedger(document.getElementById('ledger-dealer-select').value);
}

export function loadLedger(dealerCode) {
  if (!dealerCode) return;
  if (document.getElementById('entry-dealer-code')) document.getElementById('entry-dealer-code').value = dealerCode;
  if (document.getElementById('ob-dealer-code')) document.getElementById('ob-dealer-code').value = dealerCode;

  api('getLedger', session.token, dealerCode).then(function (rows) {
    var tbody = document.getElementById('ledger-table-body');
    tbody.innerHTML = '';
    var invoiceDetailHeads = ['Vehicle Sale', 'Parts Sale', 'Finance Company Advance'];
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      var viewBtn = '';
      if (r.Head === 'Total Stock') {
        viewBtn = '<button class="link-btn" onclick="openInventoryDetailModal(' + jsArg_(dealerCode) + ')">View</button>';
      } else if (invoiceDetailHeads.indexOf(r.Head) !== -1 && r['Invoice No']) {
        viewBtn = '<button class="link-btn" onclick="openDetailModal(' + jsArg_(r['Invoice No']) + ',' + jsArg_(dealerCode) + ',' + jsArg_(r.Head) + ')">View</button>';
      }
      tr.innerHTML = '<td>' + formatDateDisplay_(r['Invoice Date'] || r.Date) + '</td><td>' + r.Head + '</td><td>' + (r['Invoice No'] || '') + '</td>' +
        '<td>' + (r.Remarks || '') + '</td>' +
        '<td>' + (Number(r.Debit) ? formatMoney_(r.Debit) : '') + '</td>' +
        '<td>' + (Number(r.Credit) ? formatMoney_(r.Credit) : '') + '</td>' +
        '<td>' + formatMoney_(r['Running Balance']) + '</td>' +
        '<td>' + viewBtn + '</td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });

  api('getCreditStatus', session.token, dealerCode).then(function (status) {
    var el = document.getElementById('ledger-outstanding');
    el.textContent = formatMoney_(status.outstanding);
    var badge = document.getElementById('ledger-credit-badge');
    badge.textContent = status.status + ' \u00b7 ' + status.usedPercent + '% of limit used';
    badge.className = 'badge badge-' + status.status.toLowerCase();
  }).catch(function (err) { showToast_(err); });
}

export function loadVoucherHeadOptions() {
  api('listVoucherHeads', session.token).then(function (heads) {
    var select = document.getElementById('entry-head');
    if (!select) return;
    select.innerHTML = '';
    (heads || []).forEach(function (h) {
      var opt = document.createElement('option');
      opt.value = h['Head Name'];
      opt.textContent = h['Head Name'] + ' (' + h.Effect + ')';
      select.appendChild(opt);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleAddLedgerEntry(event) {
  event.preventDefault();
  var entry = {
    'Date':        document.getElementById('entry-date').value,
    'Head':        document.getElementById('entry-head').value,
    'Dealer Code': document.getElementById('entry-dealer-code').value,
    'Invoice No':  document.getElementById('entry-invoice').value,
    'Amount':      document.getElementById('entry-amount').value,
    'Remarks':     document.getElementById('entry-remarks').value
  };
  api('addLedgerEntry', session.token, entry).then(function () {
    showToast_(null, 'Entry added.');
    document.getElementById('new-entry-form').reset();
    loadLedger(entry['Dealer Code']);
  }).catch(function (err) { showToast_(err); });
}

export function handleSetOpeningBalance(event) {
  event.preventDefault();
  var dealerCode = document.getElementById('ob-dealer-code').value;
  var fy     = document.getElementById('ob-fy').value;
  var amount = document.getElementById('ob-amount').value;
  var type   = document.getElementById('ob-type').value;
  var effectiveDate = document.getElementById('ob-effective-date').value;
  api('setOpeningBalance', session.token, dealerCode, fy, amount, type, effectiveDate).then(function () {
    showToast_(null, 'Opening balance set.');
    document.getElementById('opening-balance-form').reset();
    loadLedger(dealerCode);
  }).catch(function (err) { showToast_(err); });
}

// ------------------------------------------ Admin duplicate-entry cleanup -
export function handleFindLedgerCleanup() {
  var invoiceNo = document.getElementById('cleanup-invoice-no').value.trim();
  if (!invoiceNo) { showToast_(new Error('Invoice No daalo pehle.')); return; }
  api('findLedgerEntriesByInvoice', session.token, invoiceNo).then(function (rows) {
    var tbody = document.getElementById('cleanup-table-body');
    tbody.innerHTML = '';
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="checkbox" class="cleanup-row-check" value="' + r['Entry ID'] + '"></td>' +
        '<td>' + formatDateDisplay_(r['Invoice Date'] || r.Date) + '</td><td>' + r.Head + '</td><td>' + r['Dealer Code'] + '</td>' +
        '<td>' + (Number(r.Debit) ? formatMoney_(r.Debit) : '') + '</td>' +
        '<td>' + (Number(r.Credit) ? formatMoney_(r.Credit) : '') + '</td>' +
        '<td>' + (r.Remarks || '') + '</td>';
      tbody.appendChild(tr);
    });
    document.getElementById('cleanup-delete-btn').style.display = (rows && rows.length) ? 'inline-block' : 'none';
    if (!rows || !rows.length) showToast_(null, 'Is invoice ke liye koi ledger entry nahi mili.');
  }).catch(function (err) { showToast_(err); });
}

export function handleDeleteLedgerCleanup() {
  var checked = Array.prototype.slice.call(document.querySelectorAll('.cleanup-row-check:checked'));
  if (!checked.length) { showToast_(new Error('Kam se kam ek entry select karo delete karne ke liye.')); return; }
  var entryIds = checked.map(function (c) { return c.value; });
  if (!window.confirm(entryIds.length + ' entries delete karni hain? Yeh Running Balance bhi turant sahi kar dega. Yeh wapas nahi ho sakta.')) return;
  api('deleteLedgerEntries', session.token, entryIds).then(function (result) {
    showToast_(null, result.deleted + ' entries delete ho gayi. Dealer(s) ka balance recompute ho gaya.');
    document.getElementById('cleanup-table-body').innerHTML = '';
    document.getElementById('cleanup-delete-btn').style.display = 'none';
    result.dealersRecomputed.forEach(function (dc) {
      var select = document.getElementById('ledger-dealer-select');
      if (select && select.value === dc) loadLedger(dc);
    });
  }).catch(function (err) { showToast_(err); });
}

// ---------------------------------------------------------- Detail modal --
export function openDetailModal(invoiceNo, dealerCode, head) {
  api('getInvoiceDetail', session.token, invoiceNo, dealerCode, head).then(function (detail) {
    document.getElementById('detail-modal-title').textContent = 'Invoice ' + invoiceNo;
    var body = document.getElementById('detail-modal-body');
    if (detail.type === 'vehicle') body.innerHTML = renderVehicleDetail_(detail);
    else if (detail.type === 'parts') body.innerHTML = renderPartsDetail_(detail);
    else body.innerHTML = '<p style="color:#888;">No extra detail stored for this entry.</p>';
    document.getElementById('detail-modal-overlay').style.display = 'flex';
  }).catch(function (err) { showToast_(err); });
}

export function closeDetailModal() {
  document.getElementById('detail-modal-overlay').style.display = 'none';
}

function renderVehicleDetail_(detail) {
  var html = '';
  var review = detail.review;
  if (review) {
    var extras = (Number(review['Registration Amount']) || 0) + (Number(review['Insurance Amount']) || 0) +
                 (Number(review['EW Amount']) || 0) + (Number(review['HPA Amount']) || 0);
    var totalDebit = (Number(review['Total Invoice Amount']) || 0) + extras;
    html += '<table><tbody>';
    html += '<tr><td>Customer</td><td>' + (review['Customer Name'] || '') + '</td></tr>';
    html += '<tr><td>Purchase Type</td><td>' + (review['Purchase Type'] || '') + '</td></tr>';
    html += '<tr><td>Total Invoice Amount (raw)</td><td>' + formatMoney_(review['Total Invoice Amount']) + '</td></tr>';
    if (review['Registration Type']) html += '<tr><td>Registration (' + review['Registration Type'] + ')</td><td>' + formatMoney_(review['Registration Amount']) + '</td></tr>';
    if (review['Insurance Type']) html += '<tr><td>Insurance' + (review['Insurance Type'] === 'Insurance from Outside' ? ' (from outside)' : '') + '</td><td>' + formatMoney_(review['Insurance Amount']) + '</td></tr>';
    if (review['EW Type']) html += '<tr><td>Extended Warranty' + (review['EW Type'] === 'No EW' ? ' (none)' : '') + '</td><td>' + formatMoney_(review['EW Amount']) + '</td></tr>';
    if (Number(review['HPA Amount'])) html += '<tr><td>HPA</td><td>' + formatMoney_(review['HPA Amount']) + '</td></tr>';
    html += '<tr class="modal-total-row"><td>Total (Debit)</td><td>' + formatMoney_(totalDebit) + '</td></tr>';
    html += '</tbody></table>';
    if (String(review['Purchase Type']).toLowerCase() === 'finance') {
      var financierShown = String(review.Financier).toLowerCase() === 'others' ? review.Hypothecation : review.Financier;
      html += '<h4 style="margin-top:14px;">Finance</h4><table><tbody>';
      html += '<tr><td>Financier</td><td>' + (financierShown || '') + '</td></tr>';
      html += '<tr><td>Finance Amount (Credit)</td><td>' + formatMoney_(review['Finance Amount']) + '</td></tr>';
      html += '</tbody></table>';
    }
  }
  html += '<h4 style="margin-top:14px;">Frame(s)</h4>';
  html += '<table><thead><tr><th>Frame No.</th><th>Model</th><th>Variant</th><th>Color</th><th>Taxable value</th><th>Tax</th><th>Amount</th></tr></thead><tbody>';
  var total = 0;
  (detail.frames || []).forEach(function (f) {
    total += Number(f['Frame Total Amount'] || 0);
    html += '<tr><td>' + f['Frame No'] + '</td><td>' + f['Model Name'] + '</td><td>' + f['Model Variant'] + '</td><td>' + f.Color + '</td>' +
      '<td>' + formatMoney_(f['Taxable Value']) + '</td><td>' + formatMoney_(f['Tax Amount']) + '</td><td>' + formatMoney_(f['Frame Total Amount']) + '</td></tr>';
  });
  html += '</tbody></table>';
  if (!review) html += '<p style="text-align:right; font-weight:bold; margin-top:6px;">Total: ' + formatMoney_(total) + '</p>';
  return html;
}

function renderPartsDetail_(detail) {
  var lines = detail.lines || [];
  var first = lines[0] || {};
  var html = '<table><tbody>';
  html += '<tr><td>Order Type</td><td>' + (first['Order Type'] || '') + '</td></tr>';
  html += '<tr><td>Customer</td><td>' + (first['Customer Name'] || '') + '</td></tr>';
  html += '</tbody></table>';
  html += '<h4 style="margin-top:14px;">Line items</h4>';
  html += '<table><thead><tr><th>Part/Labour</th><th>Part No.</th><th>HSN</th><th>Qty</th><th>Taxable</th><th>Tax</th><th>Amount</th></tr></thead><tbody>';
  var total = 0;
  lines.forEach(function (l) {
    total += Number(l['Final Amount'] || 0);
    html += '<tr><td>' + l['Part Description'] + '</td><td>' + l['Part Number'] + '</td><td>' + l['HSN Code'] + '</td><td>' + l.Qty + '</td>' +
      '<td>' + formatMoney_(l['Taxable Amount']) + '</td><td>' + formatMoney_(l['Total Tax']) + '</td><td>' + formatMoney_(l['Final Amount']) + '</td></tr>';
  });
  html += '</tbody><tfoot><tr class="modal-total-row"><td colspan="6">Total</td><td>' + formatMoney_(total) + '</td></tr></tfoot></table>';
  return html;
}

// -------------------------------------------------------- Inventory value -
export function openInventoryDetailModal(dealerCode) {
  api('getInventoryDetail', session.token, dealerCode).then(function (rows) {
    document.getElementById('detail-modal-title').textContent = 'Inventory detail';
    document.getElementById('detail-modal-body').innerHTML = renderInventoryDetail_(rows);
    document.getElementById('detail-modal-overlay').style.display = 'flex';
  }).catch(function (err) { showToast_(err); });
}

function renderInventoryDetail_(rows) {
  var html = '<table><thead><tr><th>Model Variant</th><th>Color</th><th>Frame No.</th><th>Ex-Showroom Value</th></tr></thead><tbody>';
  var total = 0;
  (rows || []).forEach(function (r) {
    total += Number(r['Ex-Showroom Value'] || 0);
    html += '<tr><td>' + r['Model Variant'] + '</td><td>' + (r.Color || '') + '</td><td>' + (r['Frame No'] || '') + '</td><td>' + formatMoney_(r['Ex-Showroom Value']) + '</td></tr>';
  });
  html += '</tbody><tfoot><tr class="modal-total-row"><td colspan="3">Total</td><td>' + formatMoney_(total) + '</td></tr></tfoot></table>';
  return html;
}

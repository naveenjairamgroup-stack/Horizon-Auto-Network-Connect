/**
 * review.js — the Review tab (Admin only).
 * Lists duplicate / over-reversed invoice groups found by the backend and
 * lets Admin delete the extra rows. Nothing is deleted without a tick and a
 * confirmation.
 */
import { api } from '../api.js';
import { session } from '../session.js';
import { jsArg_, formatMoney_, formatDateDisplay_, formatDateTimeDisplay_, showToast_, esc_, withBusy_ } from '../utils.js';
import { refreshSidebarCounts } from '../sidebar.js';

var groups = [];

export function loadReview() {
  document.getElementById('review-list').innerHTML = '<p class="muted">Checking every ledger…</p>';
  api('listLedgerDuplicates', session.token).then(function (rows) {
    groups = rows || [];
    render_();
    refreshSidebarCounts();
  }).catch(function (err) { showToast_(err); });
}

function render_() {
  var summary = document.getElementById('review-summary');
  var list = document.getElementById('review-list');
  if (!groups.length) {
    summary.innerHTML = '<span class="badge badge-green">All clear</span> <span class="muted">No duplicate invoices in any ledger.</span>';
    list.innerHTML = '';
    return;
  }
  var dup = groups.filter(function (g) { return g.problem === 'Duplicate posting'; }).length;
  summary.innerHTML = '<span class="badge badge-red">' + groups.length + ' to review</span> ' +
    '<span class="muted">' + dup + ' duplicate posting(s), ' + (groups.length - dup) + ' extra reversal(s)</span>';

  list.innerHTML = groups.map(function (g, gi) {
    var rows = g.rows.map(function (r) {
      return '<tr class="' + (r.suggested ? 'suggested' : '') + '">' +
        '<td><input type="checkbox" class="rv-pick" data-g="' + gi + '" value="' + esc_(r.entryId) + '"' + (r.suggested ? ' checked' : '') + '></td>' +
        '<td>' + formatDateDisplay_(r.date) + '</td>' +
        '<td>' + (r.debit ? formatMoney_(r.debit) : '') + '</td>' +
        '<td>' + (r.credit ? formatMoney_(r.credit) : '') + '</td>' +
        '<td>' + esc_(r.remarks) + '</td>' +
        '<td>' + esc_(r.createdBy) + '</td>' +
        '<td>' + formatDateTimeDisplay_(r.timestamp) + '</td>' +
        '<td class="muted">' + esc_(r.entryId) + '</td></tr>';
    }).join('');
    return '<div class="review-group">' +
      '<h4>' + esc_(g.dealerName || g.dealerCode) + ' — ' + esc_(g.invoiceNo) + '</h4>' +
      '<div class="review-meta"><span class="badge ' + (g.problem === 'Duplicate posting' ? 'badge-red' : 'badge-yellow') + '">' +
      esc_(g.problem) + '</span> &nbsp;' + esc_(g.head) + ' · ' + esc_(g.dealerCode) +
      ' · ' + g.extraCount + ' extra · net on this invoice ' + formatMoney_(g.net) + '</div>' +
      '<table><thead><tr><th></th><th>Date</th><th>Debit</th><th>Credit</th><th>Remarks</th><th>By</th><th>Entered</th><th>Entry</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<button type="button" style="margin-top:8px;" onclick="deleteReviewSelection(this,' + gi + ')">Delete ticked</button></div>';
  }).join('');
}

export function deleteReviewSelection(button, gi) {
  var ids = Array.prototype.slice.call(document.querySelectorAll('.rv-pick[data-g="' + gi + '"]:checked'))
    .map(function (c) { return c.value; });
  var g = groups[gi];
  if (!ids.length) { showToast_(new Error('Tick at least one entry to delete.')); return; }
  if (ids.length >= g.rows.length) {
    showToast_(new Error('Every entry of this invoice is ticked. Keep at least one — deleting all would remove a real transaction.'));
    return;
  }
  if (!window.confirm('Delete ' + ids.length + ' entr' + (ids.length > 1 ? 'ies' : 'y') + ' from ' +
      (g.dealerName || g.dealerCode) + "'s ledger for invoice " + g.invoiceNo + '? This cannot be undone.')) return;
  withBusy_(button, function () {
    return api('deleteLedgerEntries', session.token, ids).then(function (res) {
      showToast_(null, res.deleted + ' entr' + (res.deleted > 1 ? 'ies' : 'y') + ' deleted. Balance recalculated.');
      loadReview();
    });
  }).catch(function (err) { showToast_(err); });
}

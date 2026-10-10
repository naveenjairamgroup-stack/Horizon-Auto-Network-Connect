/**
 * LedgerReviewService.gs
 * The Review tab: finds invoices that sit in a dealer's ledger more times
 * than they should, and the badge counts shown beside sidebar tabs.
 *
 * ---------------------------------------------------------------------
 * THE DETECTION RULE
 * ---------------------------------------------------------------------
 * Every ledger row with an Invoice No is grouped by
 *        Dealer Code + Invoice No + Head
 * and within the group the rows are counted by side:
 *   N = rows on the head's NORMAL side (Debit for Vehicle Sale, Parts Sale;
 *       Credit for Finance Company Advance, Payment Received, Commission...)
 *   R = rows on the opposite side — reversals
 *
 * A healthy invoice is N = R + 1 (posted, maybe reversed and re-posted) or
 * N = R (fully reversed). So:
 *   N - R >= 2   -> DUPLICATE POSTING  (posted again without a reversal)
 *   R - N >= 1   -> EXTRA REVERSAL     (reversed more times than posted —
 *                                       the old re-import bug)
 *
 * Why Head is part of the key: a financed ASC vehicle legitimately puts its
 * invoice in the ledger twice — a Vehicle Sale debit and a Finance Company
 * Advance credit. Those are different heads, so they never land in the same
 * group, and the finance case needs no special exception at all.
 *
 * Rows with no Invoice No (manual entries, opening balances, stock
 * snapshots) are never grouped — they would all collide on the empty string.
 * Parts returns are left out too: several partial returns against one parts
 * invoice are normal.
 *
 * Nothing is deleted automatically. The likely extras are pre-selected for
 * Admin, who confirms; deletion goes through the existing
 * deleteLedgerEntries (audited, balance recomputed).
 * ---------------------------------------------------------------------
 */

var REVIEW_HEADS = {
  'Vehicle Sale': true,
  'Parts Sale': true,
  'Finance Company Advance': true,
  'Payment Received': true,
  'Commission': true,
  'Vehicle Purchase / Return': true
};

/** Every flagged invoice group, worst first. Admin only. */
function listLedgerDuplicates(token) {
  return safeRun('listLedgerDuplicates', function () {
    requireRole_(token, [ROLES.ADMIN]);
    return findLedgerDuplicates_();
  });
}

function findLedgerDuplicates_() {
  var effects = {};
  getAllRows(SHEETS.VOUCHER_HEAD_MASTER).forEach(function (h) { effects[h['Head Name']] = h.Effect; });
  var names = getDealerNameMap_();

  var groups = {};
  getAllRows(SHEETS.LEDGER_TRANSACTIONS).forEach(function (r) {
    var inv = String(r['Invoice No'] || '').trim();
    if (!inv) return;
    if (!REVIEW_HEADS[r.Head]) return;
    var key = r['Dealer Code'] + '|' + inv + '|' + r.Head;
    (groups[key] = groups[key] || []).push(r);
  });

  var out = [];
  Object.keys(groups).forEach(function (key) {
    var rows = groups[key];
    if (rows.length < 2) return;
    var head = rows[0].Head;
    var normalIsDebit = effects[head] !== EFFECT.DECREASE; // unknown head -> treat as debit-normal
    var normal = [], opposite = [];
    rows.forEach(function (r) {
      var isDebit = (Number(r.Debit) || 0) > 0;
      (isDebit === normalIsDebit ? normal : opposite).push(r);
    });

    var extraPostings = normal.length - opposite.length - 1;
    var extraReversals = opposite.length - normal.length;
    if (extraPostings < 1 && extraReversals < 1) return;

    // Pre-select the most recent extras — the original posting is the one
    // to keep. Admin can change the selection before deleting.
    var byNewest = function (a, b) { return new Date(b.Timestamp || b.Date) - new Date(a.Timestamp || a.Date); };
    var suggested = [];
    if (extraPostings > 0) suggested = normal.slice().sort(byNewest).slice(0, extraPostings);
    else suggested = opposite.slice().sort(byNewest).slice(0, extraReversals);
    var suggestedIds = {};
    suggested.forEach(function (r) { suggestedIds[r['Entry ID']] = true; });

    var net = rows.reduce(function (s, r) { return s + (Number(r.Debit) || 0) - (Number(r.Credit) || 0); }, 0);

    out.push({
      key: key,
      dealerCode: rows[0]['Dealer Code'],
      dealerName: names[rows[0]['Dealer Code']] || '',
      invoiceNo: rows[0]['Invoice No'],
      head: head,
      problem: extraPostings > 0 ? 'Duplicate posting' : 'Extra reversal',
      extraCount: Math.max(extraPostings, extraReversals),
      net: Math.round(net * 100) / 100,
      rows: rows.slice().sort(function (a, b) { return new Date(a.Timestamp || a.Date) - new Date(b.Timestamp || b.Date); })
        .map(function (r) {
          return {
            entryId: r['Entry ID'], date: r.Date, debit: Number(r.Debit) || 0, credit: Number(r.Credit) || 0,
            remarks: r.Remarks || '', createdBy: r['Created By'] || '', timestamp: r.Timestamp || '',
            suggested: !!suggestedIds[r['Entry ID']]
          };
        })
    });
  });

  out.sort(function (a, b) { return b.extraCount - a.extraCount || String(a.dealerName).localeCompare(String(b.dealerName)); });
  return out;
}

/**
 * Badge numbers for the sidebar, in one call so the sidebar never fires
 * three requests. Each count is scoped to what that user can act on; a role
 * that does not see a tab gets null for it.
 */
function getSidebarCounts(token) {
  return safeRun('getSidebarCounts', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER]);
    var isDealer = session.role === ROLES.DEALER;

    var pendingPayments = getAllRows(SHEETS.PAYMENT_ENTRIES).filter(function (r) {
      if (r['Approval Status'] !== APPROVAL_STATUS.PENDING) return false;
      return !isDealer || String(r['Dealer Code']) === String(session.dealerCode);
    }).length;

    var pendingVsr = null;
    if (session.role === ROLES.ADMIN || session.role === ROLES.NETWORK_MANAGER) {
      pendingVsr = getAllRows(SHEETS.VEHICLE_SALE_REVIEW_QUEUE).filter(function (r) {
        return String(r.Status) === 'Pending';
      }).length;
    }

    var review = session.role === ROLES.ADMIN ? findLedgerDuplicates_().length : null;

    return { Payments: pendingPayments, VehicleSaleReview: pendingVsr, Review: review };
  });
}

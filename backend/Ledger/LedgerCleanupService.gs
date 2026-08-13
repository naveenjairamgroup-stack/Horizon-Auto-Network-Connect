/**
 * LedgerCleanupService.gs
 * Admin-only tool for correcting duplicate/mistaken Ledger_Transactions
 * rows WITHOUT hand-editing the sensitive Sheet directly. Deliberately does
 * NOT try to auto-detect "which rows are the duplicates" — that's a
 * judgment call a human should make by reading the actual entries, not
 * something worth guessing at in code and risking deleting a legitimate
 * repeat transaction. This just makes the two safe steps (look, then
 * delete-by-exact-ID) available as buttons instead of raw Sheet editing:
 * every deletion recomputes the affected dealer's Running Balance
 * afterwards and is written to the Audit Log like any other action.
 */

/** Every Ledger_Transactions row for one invoice, oldest first, so a duplicate run is easy to spot by eye. */
function findLedgerEntriesByInvoice(token, invoiceNo) {
  return safeRun('findLedgerEntriesByInvoice', function () {
    requireRole_(token, [ROLES.ADMIN]);
    if (!invoiceNo) throw new Error('Invoice No is required.');
    var rows = findRows(SHEETS.LEDGER_TRANSACTIONS, { 'Invoice No': invoiceNo });
    rows.sort(function (a, b) { return new Date(a.Date) - new Date(b.Date); });
    return rows;
  });
}

/**
 * Deletes exactly the rows whose Entry ID is in entryIds — nothing else,
 * no pattern-matching. Recomputes Running Balance for every dealer touched
 * (a duplicate cleanup can span more than one dealer's rows if Frame/Detail
 * data got tangled), and logs precisely what was removed.
 */
function deleteLedgerEntries(token, entryIds) {
  return safeRun('deleteLedgerEntries', function () {
    var session = requireRole_(token, [ROLES.ADMIN]);
    if (!entryIds || !entryIds.length) throw new Error('No entries selected.');

    var allRows = getAllRows(SHEETS.LEDGER_TRANSACTIONS);
    var toDelete = allRows.filter(function (r) { return entryIds.indexOf(r['Entry ID']) !== -1; });
    if (toDelete.length === 0) throw new Error('None of the selected entries were found — they may have already been deleted.');

    var affectedDealers = {};
    toDelete.forEach(function (r) { affectedDealers[r['Dealer Code']] = true; });

    deleteRowsWhere_(SHEETS.LEDGER_TRANSACTIONS, toDelete);
    Object.keys(affectedDealers).forEach(function (dc) { recomputeRunningBalance_(dc); });

    logAction(
      session.username,
      'MANUAL LEDGER CLEANUP',
      JSON.stringify(toDelete.map(function (r) { return r['Entry ID'] + ' | ' + r.Head + ' | Dr ' + r.Debit + ' Cr ' + r.Credit; })),
      'Deleted ' + toDelete.length + ' entr' + (toDelete.length === 1 ? 'y' : 'ies') + ' for dealer(s): ' + Object.keys(affectedDealers).join(', ')
    );

    return { deleted: toDelete.length, dealersRecomputed: Object.keys(affectedDealers) };
  });
}

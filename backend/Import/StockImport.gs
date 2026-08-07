/**
 * StockImport.gs
 * Physical stock/inventory report — shows which vehicles are currently
 * sitting with each ASC dealer, and values that stock using a separately
 * maintained "All Model Price List" master (Model Variant → Ex-Showroom
 * Price). Rules confirmed in chat:
 *   - Match dealer via the "Inventory Location" column against Dealer_Master's
 *     "Inventory Location Alias" (a DEDICATED alias — deliberately separate
 *     from "Vehicle Sale Alias", since the two source reports use different
 *     naming conventions for the same dealer and coincidentally matching for
 *     some of them isn't something a financial system should rely on).
 *   - Only rows whose Physical Status is in STOCK_COUNTABLE_PHYSICAL_STATUSES
 *     ('Received-OK', 'In-Transit') count as real sitting inventory.
 *   - This is a point-in-time snapshot, not an accumulating transaction: every
 *     import fully REPLACES the previously stored inventory for every dealer
 *     that has an "Inventory Location Alias" configured — including wiping a
 *     dealer down to zero if they no longer appear in the new file at all.
 *   - Inventory value posts as a REAL ledger Debit row (Head = 'Total Stock',
 *     Remarks = 'Inventory value', dated at the stock file's own date) —
 *     Honda has effectively already funded whatever is sitting unsold at the
 *     dealer, so it counts toward Outstanding / Credit Status / Dashboard
 *     totals exactly like Vehicle Sale or Parts Sale do, with zero extra code
 *     anywhere else in the system (they all already sum Ledger_Transactions).
 *   - Each new import DELETES the dealer's previous 'Total Stock' row outright
 *     (not a credit-note reversal like other heads) and inserts a fresh one —
 *     it's a snapshot of "right now", not a discrete transaction worth
 *     preserving in the audit trail forever. A dealer with zero stock in the
 *     new file simply loses their row (nothing re-inserted).
 *   - "All Model Price List" is a plain reference tab maintained directly in
 *     the Sheet by Admin (see the deployment guide) — no dedicated UI, since
 *     it only changes when Honda revises the price list.
 */

function runStockImport_(actor) {
  var files = listFilesInFolder_(IMPORT_SUBFOLDERS.STOCK);
  if (files.length === 0) return { folder: 'Stock', files: 0, processed: 0, skipped: 0, updated: 0, reversed: 0 };

  // Snapshot, not a transaction log — only the newest file matters, and it fully replaces prior state.
  var file = files[0];
  var fileDate = file.getLastUpdated(); // best available proxy for "the date this was exported"
  var rows = readTsvUtf16File_(file);
  var countable = rows.filter(function (r) { return STOCK_COUNTABLE_PHYSICAL_STATUSES[r['Physical Status']]; });
  var grouped = groupBy_(countable, 'Inventory Location');

  var dealersWithAlias = getAllRows(SHEETS.DEALER_MASTER).filter(function (d) { return d['Inventory Location Alias']; });

  // Wipe every configured dealer's prior detail snapshot first, so a dealer
  // that no longer appears anywhere in the new file correctly ends up at
  // zero rather than keeping stale rows forever.
  dealersWithAlias.forEach(function (d) {
    var oldRows = findRows(SHEETS.INVENTORY_DETAIL, { 'Dealer Code': d['Dealer Code'] });
    if (oldRows.length) deleteRowsWhere_(SHEETS.INVENTORY_DETAIL, oldRows);
  });

  var aliasMap = {};
  dealersWithAlias.forEach(function (d) { aliasMap[normalizeName_(d['Inventory Location Alias'])] = d['Dealer Code']; });

  var totalsByDealer = {}; // Dealer Code -> running sum of Ex-Showroom Value
  var processed = 0, skipped = 0;
  grouped.order.forEach(function (invLocation) {
    var dealerCode = aliasMap[normalizeName_(invLocation)];
    var lines = grouped.groups[invLocation];
    if (!dealerCode) { skipped += lines.length; return; }
    lines.forEach(function (v) {
      var price = lookupExShowroomPrice_(v['Model Variant']);
      appendRow(SHEETS.INVENTORY_DETAIL, {
        'Detail ID': generateId('INV'),
        'Dealer Code': dealerCode,
        'Frame No': v['Frame #'],
        'Model Variant': v['Model Variant'],
        'Color': v['Color'],
        'Ex-Showroom Value': price,
        'Created On': new Date()
      }, 'System (Import)');
      totalsByDealer[dealerCode] = (totalsByDealer[dealerCode] || 0) + price;
      processed++;
    });
  });

  // Replace every configured dealer's "Total Stock" ledger row — including
  // dealers who dropped to zero (not in this file at all), so their old
  // line disappears instead of staying stale forever.
  dealersWithAlias.forEach(function (d) {
    postOrReplaceTotalStockLedgerRow_(d['Dealer Code'], totalsByDealer[d['Dealer Code']] || 0, fileDate);
  });

  logImportRun_(file.getName(), 'Stock', processed, skipped, 0, 0, 'Success');
  return { folder: 'Stock', files: files.length, processed: processed, skipped: skipped, updated: 0, reversed: 0 };
}

/**
 * Deletes a dealer's existing "Total Stock" ledger row (if any) and — only
 * if there's actually stock to value — inserts a fresh one dated at the
 * stock file's own date. Unlike reverseLedgerEntry_ (used for Vehicle Sale /
 * Parts Sale corrections), this is a straight delete-and-replace: an
 * inventory snapshot from three days ago has no ongoing audit-trail value
 * once a newer one exists.
 */
function postOrReplaceTotalStockLedgerRow_(dealerCode, totalValue, asOfDate) {
  var oldRows = findRows(SHEETS.LEDGER_TRANSACTIONS, { 'Dealer Code': dealerCode, 'Head': 'Total Stock' });
  if (oldRows.length) deleteRowsWhere_(SHEETS.LEDGER_TRANSACTIONS, oldRows);

  if (totalValue > 0) {
    appendRow(SHEETS.LEDGER_TRANSACTIONS, {
      'Entry ID': generateId('LED'),
      'Date': asOfDate,
      'Invoice No': '',
      'Head': 'Total Stock',
      'Dealer Code': dealerCode,
      'Debit': totalValue,
      'Credit': 0,
      'Running Balance': 0,
      'Remarks': 'Inventory value',
      'Created By': 'System (Import)',
      'Timestamp': new Date(),
      'Invoice Date': asOfDate
    }, 'System (Import)');
  }
  recomputeRunningBalance_(dealerCode);
}

/**
 * Looks up a Model Variant's Ex-Showroom Price from the "All Model Price
 * List" tab (Admin-maintained directly in the Sheet). Returns 0 — not an
 * error — if the variant isn't in the list yet, so one missing price
 * doesn't break the whole import; the Admin just needs to add that variant.
 */
function lookupExShowroomPrice_(modelVariant) {
  var key = normalizeModelVariant_(modelVariant);
  if (!key) return 0;
  var rows = getAllRows(SHEETS.ALL_MODEL_PRICE_LIST);
  for (var i = 0; i < rows.length; i++) {
    if (normalizeModelVariant_(rows[i]['Model Variant']) === key) return parseAmount_(rows[i]['Ex-Showroom Price']);
  }
  return 0;
}

/** The itemised popup behind the "Total Stock" ledger row's View button: every vehicle in stock, Model Variant sequence (alphabetical), with Color/Frame/Value + total. */
function getInventoryDetail(token, dealerCode) {
  return safeRun('getInventoryDetail', function () {
    var session = requireRole_(token, PERMISSIONS.Inventory.view);
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own inventory.');
    }
    var rows = findRows(SHEETS.INVENTORY_DETAIL, { 'Dealer Code': dealerCode });
    rows.sort(function (a, b) {
      var av = String(a['Model Variant']), bv = String(b['Model Variant']);
      return av === bv ? 0 : (av < bv ? -1 : 1);
    });
    return rows;
  });
}

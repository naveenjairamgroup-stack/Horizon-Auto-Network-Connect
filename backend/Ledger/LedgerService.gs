/**
 * LedgerService.gs
 * Every Vehicle/Parts bill, approved payment, approved return, and commission
 * credit lands here as one row (Phase 1 supports direct entries by
 * Admin/Accounts; Phase 2's Payments/Returns modules post here automatically
 * once approved — see architecture doc section 6).
 */

function addLedgerEntry(token, entry) {
  return safeRun('addLedgerEntry', function () {
    var session = requireRole_(token, PERMISSIONS.Ledger.edit);
    requireFields(entry, ['Date', 'Head', 'Dealer Code']);
    if (!findRow(SHEETS.DEALER_MASTER, 'Dealer Code', entry['Dealer Code'])) {
      throw new Error('Dealer not found: ' + entry['Dealer Code']);
    }
    var effect = getHeadEffect_(entry.Head); // throws if head unknown
    var amount = Math.abs(Number(entry.Amount) || 0);
    if (amount === 0) throw new Error('Amount must be greater than zero.');

    var row = {
      'Entry ID': generateId('LED'),
      'Date': entry.Date,
      'Invoice No': entry['Invoice No'] || '',
      'Head': entry.Head,
      'Dealer Code': entry['Dealer Code'],
      'Debit': effect === EFFECT.INCREASE ? amount : 0,
      'Credit': effect === EFFECT.DECREASE ? amount : 0,
      'Running Balance': 0, // recomputed below
      'Remarks': entry.Remarks || '',
      'Created By': session.username,
      'Timestamp': new Date()
    };
    appendRow(SHEETS.LEDGER_TRANSACTIONS, row, session.username);
    recomputeRunningBalance_(entry['Dealer Code']);
    return row;
  });
}

/**
 * One dealer's ledger, optionally for a date range.
 *
 * With fromDate/toDate ('YYYY-MM-DD', inclusive, India time) the result is
 * that window only, led by a synthetic "Opening balance" row carrying the
 * balance as it stood the moment the window opens — FY opening plus every
 * entry dated before fromDate. Balances are computed here from the entries
 * themselves rather than read from the stored Running Balance column, so a
 * range view is correct even if that column is momentarily behind.
 *
 * Without dates it behaves exactly as before: the whole ledger.
 */
function getLedger(token, dealerCode, fromDate, toDate) {
  return safeRun('getLedger', function () {
    var session = requireRole_(token, PERMISSIONS.Ledger.view);
    if (session.role === ROLES.DEALER && session.dealerCode !== dealerCode) {
      throw new Error('You can only view your own ledger.');
    }
    var fy = getCurrentFinancialYear_();
    var opening = getOpeningBalance(dealerCode, fy);
    var openingSigned = opening['Balance Type'] === 'Cr' ? -Number(opening.Amount || 0) : Number(opening.Amount || 0);

    var rows = sortLedgerRows_(findRows(SHEETS.LEDGER_TRANSACTIONS, { 'Dealer Code': dealerCode }));

    // Recompute balances from scratch, in order.
    var bal = openingSigned;
    rows = rows.map(function (r) {
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      bal += (Number(r.Debit) || 0) - (Number(r.Credit) || 0);
      out['Running Balance'] = Math.round(bal * 100) / 100;
      return out;
    });

    if (!fromDate && !toDate) {
      if (Number(opening.Amount) > 0) {
        var isDr = opening['Balance Type'] !== 'Cr';
        rows = [{
          'Entry ID': '',
          'Date': opening['Effective Date'] || opening['Set On'] || new Date(),
          'Invoice No': '',
          'Head': 'Opening Balance',
          'Dealer Code': dealerCode,
          'Debit': isDr ? Number(opening.Amount) : 0,
          'Credit': isDr ? 0 : Number(opening.Amount),
          'Running Balance': openingSigned,
          'Remarks': 'Opening balance (' + fy + ')',
          'Created By': opening['Set By'] || '',
          'Timestamp': opening['Set On'] || ''
        }].concat(rows);
      }
      return rows;
    }

    var from = fromDate ? istDayStart_(fromDate) : null;
    var to = toDate ? istDayEnd_(toDate) : null;

    var before = openingSigned;
    var inRange = [];
    rows.forEach(function (r) {
      var d = new Date(r.Date);
      if (from && d < from) { before = r['Running Balance']; return; }
      if (to && d > to) return;
      inRange.push(r);
    });

    var openRow = {
      'Entry ID': '',
      'Date': from || (inRange[0] ? inRange[0].Date : new Date()),
      'Invoice No': '',
      'Head': 'Opening Balance',
      'Dealer Code': dealerCode,
      'Debit': before > 0 ? before : 0,
      'Credit': before < 0 ? -before : 0,
      'Running Balance': before,
      'Remarks': 'Balance as on ' + (fromDate ? Utilities.formatDate(from, 'Asia/Kolkata', 'dd-MM-yyyy') : 'start'),
      'Created By': '',
      'Timestamp': ''
    };
    return [openRow].concat(inRange);
  });
}

/** Date order, with Timestamp breaking ties so same-day entries never shuffle between views. */
function sortLedgerRows_(rows) {
  return rows.slice().sort(function (a, b) {
    var d = new Date(a.Date) - new Date(b.Date);
    if (d !== 0) return d;
    return new Date(a.Timestamp || 0) - new Date(b.Timestamp || 0);
  });
}

/** 'YYYY-MM-DD' -> that calendar day's first / last instant in India time. */
function istDayStart_(ymd) { return new Date(String(ymd).slice(0, 10) + 'T00:00:00+05:30'); }
function istDayEnd_(ymd) { return new Date(String(ymd).slice(0, 10) + 'T23:59:59.999+05:30'); }

/**
 * Recomputes Running Balance for every entry of one dealer, in date order,
 * starting from that dealer's Opening Balance. Called after every add so
 * back-dated entries (e.g. a late Return) keep the ledger correct.
 *
 * Writes back in ONE call. It used to call setValue() once per row of the
 * dealer, and it runs after every single ledger insert — so an import of
 * 100 invoices for a dealer with 1,000 rows made roughly 100,000 separate
 * Sheets calls and could run into Apps Script's 6-minute limit. Now the span
 * covering that dealer's rows is written back in one setValues(); rows of
 * other dealers inside the span are written back unchanged.
 */
function recomputeRunningBalance_(dealerCode) {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.LEDGER_TRANSACTIONS);
  var headers = getHeaders_(SHEETS.LEDGER_TRANSACTIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var dealerCol = headers.indexOf('Dealer Code');
  var dateCol = headers.indexOf('Date');
  var tsCol = headers.indexOf('Timestamp');
  var debitCol = headers.indexOf('Debit');
  var creditCol = headers.indexOf('Credit');
  var balCol = headers.indexOf('Running Balance');

  var fy = getCurrentFinancialYear_();
  var opening = getOpeningBalance(dealerCode, fy);
  var balance = opening['Balance Type'] === 'Cr' ? -Number(opening.Amount) : Number(opening.Amount);

  var indices = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][dealerCol]) === String(dealerCode)) indices.push(i);
  }
  if (indices.length === 0) return;
  indices.sort(function (a, b) {
    var d = new Date(values[a][dateCol]) - new Date(values[b][dateCol]);
    if (d !== 0) return d;
    return new Date(values[a][tsCol] || 0) - new Date(values[b][tsCol] || 0);
  });

  var lo = Math.min.apply(null, indices);
  var hi = Math.max.apply(null, indices);
  var col = [];
  for (var k = lo; k <= hi; k++) col.push([values[k][balCol]]);

  indices.forEach(function (i) {
    balance = balance + Number(values[i][debitCol] || 0) - Number(values[i][creditCol] || 0);
    col[i - lo][0] = balance;
  });
  sheet.getRange(lo + 2, balCol + 1, col.length, 1).setValues(col);
  invalidateSheetCache_(SHEETS.LEDGER_TRANSACTIONS);
}

// ======================================================= BULK ENTRY ===
/**
 * Posts one head (Interest or Commission) for many dealers at once, each
 * with its own amount — the screen that replaces opening every dealer's
 * ledger in turn.
 *
 * ALL OR NOTHING. Every row is checked first; if any fails, nothing is
 * posted and every problem comes back with its reason, so a half-applied
 * batch can never leave the ledgers in an in-between state.
 *
 * Commission guard: bulk Commission exists for months before the commission
 * module. A row dated in a month for which that dealer already has a
 * Posted commission report is refused — that month was already credited by
 * the module, and posting it here too would pay it twice.
 */
function postBulkLedgerEntries(token, head, date, entries, commonRemarks) {
  return safeRun('postBulkLedgerEntries', function () {
    var session = requireRole_(token, [ROLES.ADMIN, ROLES.ACCOUNTS]);
    if (!BULK_ENTRY_HEADS[head]) {
      throw new Error('Bulk entry supports only: ' + Object.keys(BULK_ENTRY_HEADS).join(', ') + '.');
    }
    if (!date) throw new Error('Date is required.');
    if (!entries || !entries.length) throw new Error('Add at least one dealer.');
    ensureVoucherHead_(head);
    var effect = getHeadEffect_(head);

    var entryDate = istDayStart_(date);
    var monthKey = Utilities.formatDate(entryDate, 'Asia/Kolkata', 'yyyy-MM');
    var postedCommission = {};
    if (head === 'Commission') {
      getAllRows(SHEETS.COMMISSION_REPORT).forEach(function (r) {
        if (String(r.Status) === COMMISSION_STATUS.POSTED && normalizeMonthKey_(r.Month) === monthKey) {
          postedCommission[r['Dealer Code']] = true;
        }
      });
    }

    var dealers = {};
    getAllRows(SHEETS.DEALER_MASTER).forEach(function (d) { dealers[d['Dealer Code']] = d; });

    var errors = [];
    var seen = {};
    var rows = [];
    entries.forEach(function (e, i) {
      var code = String(e.dealerCode || '').trim();
      var amount = Math.abs(Number(e.amount) || 0);
      var where = 'Row ' + (i + 1) + (code ? ' (' + code + ')' : '');
      if (!code) { errors.push(where + ': dealer not selected.'); return; }
      if (!dealers[code]) { errors.push(where + ': dealer not found.'); return; }
      if (seen[code]) { errors.push(where + ': dealer appears more than once in this batch.'); return; }
      seen[code] = true;
      if (!(amount > 0)) { errors.push(where + ': amount must be greater than zero.'); return; }
      if (postedCommission[code]) {
        errors.push(where + ': commission for ' + monthKey + ' is already posted by the Commission module — this would pay it twice.');
        return;
      }
      rows.push({
        'Entry ID': generateId('LED'),
        'Date': entryDate,
        'Invoice No': String(e.invoiceNo || '').trim(),
        'Head': head,
        'Dealer Code': code,
        'Debit': effect === EFFECT.INCREASE ? amount : 0,
        'Credit': effect === EFFECT.DECREASE ? amount : 0,
        'Running Balance': 0,
        'Remarks': String(e.remarks || commonRemarks || '').trim(),
        'Created By': session.username,
        'Timestamp': new Date()
      });
    });

    if (errors.length) return { posted: 0, errors: errors };

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      appendRows(SHEETS.LEDGER_TRANSACTIONS, rows, session.username);
      Object.keys(seen).forEach(function (code) { recomputeRunningBalance_(code); });
    } finally {
      lock.releaseLock();
    }
    var total = rows.reduce(function (s, r) { return s + (r.Debit || r.Credit); }, 0);
    return { posted: rows.length, errors: [], total: total, side: effect === EFFECT.INCREASE ? 'Debit' : 'Credit' };
  });
}

/** Adds a ledger head to Voucher_Head_Master if it is not there yet. Only touches the sheet when something is missing. */
function ensureVoucherHead_(head) {
  var exists = getAllRows(SHEETS.VOUCHER_HEAD_MASTER).some(function (r) { return String(r['Head Name']) === head; });
  if (exists) return;
  var spec = {
    'Interest':   ['Journal',  EFFECT.INCREASE, false, true],
    'Commission': ['Purchase', EFFECT.DECREASE, true,  true]
  }[head];
  if (!spec) throw new Error('Unknown head: ' + head);
  appendRow(SHEETS.VOUCHER_HEAD_MASTER, {
    'Head Name': head, 'Vch Type': spec[0], 'Effect': spec[1], 'GST Applicable': spec[2], 'Active': spec[3]
  }, 'System');
}

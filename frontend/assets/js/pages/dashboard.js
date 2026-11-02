/**
 * dashboard.js
 * Every role's dashboard is drawn here into its page's `.dash` container.
 * The page fragment only says which title and which "waiting for action"
 * queues that role sees (data-title / data-actions); the layout is shared so
 * the four dashboards never drift apart.
 *
 *   Admin / NM / Accounts:  network balance (hero) · dealers · over limit
 *                           · waiting-for-action tiles · dealer-wise balance bars
 *   Dealer:                 own balance (hero) · credit limit meter · shortcuts
 *
 * Balances are signed like the ledger: positive = Dr (dealer owes Horizon),
 * negative = Cr (Horizon owes the dealer). They are always shown as an amount
 * plus the word Dr/Cr, never with a minus sign, and the bar colour is never
 * the only cue — the Dr/Cr word sits beside every figure.
 */
import { api } from '../api.js';
import { session } from '../session.js';
import { dashboardPageForRole } from '../router.js';
import { showToast_, esc_ } from '../utils.js';

var ACTIONS = {
  Payments:          { key: 'pendingPayments',           label: 'Payments waiting for approval' },
  Returns:           { key: 'pendingReturns',            label: 'Returns waiting for approval' },
  VehicleSaleReview: { key: 'pendingVehicleSaleReviews', label: 'Vehicle sales to review' },
  PartsReview:       { key: 'pendingPartsSaleReviews',   label: 'Parts invoices to assign' }
};

var STATUS = {
  Green:  { cls: 'st-good', icon: '✓', text: 'Within limit' },
  Yellow: { cls: 'st-warn', icon: '!',      text: 'Near limit' },
  Red:    { cls: 'st-crit', icon: '✕', text: 'Over limit' }
};

/**
 * ₹12,34,568 — whole rupees. The dashboard is for reading the picture at a
 * glance; paise only add noise here. Exact figures stay in the Ledger.
 */
function rupees_(n) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** ₹12,34,568 Dr / Cr — the amount without a sign, the side in words. */
function drCr_(n) {
  var v = Math.round(Number(n) || 0);
  if (v === 0) return rupees_(0);
  return rupees_(Math.abs(v)) + ' <span class="drcr">' + (v > 0 ? 'Dr' : 'Cr') + '</span>';
}

function nowTime_() {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export function loadDashboardSummary() {
  var container = document.getElementById('page-' + dashboardPageForRole(session.role));
  var root = container && container.querySelector('.dash');
  if (!root) return;
  if (root.classList.contains('dash-dealer')) loadDealerDashboard_(root);
  else loadNetworkDashboard_(root);
}

// ============================================================ NETWORK ===
function networkSkeleton_(root) {
  var actions = (root.getAttribute('data-actions') || '').split(',').filter(function (a) { return ACTIONS[a]; });
  root.innerHTML =
    '<div class="dash-head"><h2>' + esc_(root.getAttribute('data-title') || 'Dashboard') + '</h2>' +
      '<div class="dash-asof"><span class="muted js-asof"></span>' +
      '<button type="button" class="link-btn" onclick="loadDashboardSummary()">Refresh</button></div></div>' +

    '<div class="dash-top">' +
      '<div class="dcard dash-hero">' +
        '<div class="dash-label">Network balance</div>' +
        '<div class="dash-hero-value js-total">—</div>' +
        '<div class="dash-hero-sub js-total-sub"></div>' +
        '<div class="dash-split js-split"></div>' +
      '</div>' +
      '<div class="dcard dash-stat">' +
        '<div class="dash-label">Dealers</div>' +
        '<div class="dash-stat-value js-dealers">—</div>' +
        '<div class="dash-stat-sub js-types"></div>' +
      '</div>' +
      '<div class="dcard dash-stat">' +
        '<div class="dash-label">Over credit limit</div>' +
        '<div class="dash-stat-value js-over">—</div>' +
        '<div class="dash-stat-sub js-over-sub"></div>' +
      '</div>' +
    '</div>' +

    (actions.length
      ? '<div class="dash-section-title">Waiting for action</div><div class="dash-actions">' +
        actions.map(function (a) {
          return '<button type="button" class="dash-action" data-action="' + a + '" onclick="goToPage(\'' + a + '\')">' +
            '<span class="da-num">—</span><span class="da-label">' + esc_(ACTIONS[a].label) + '</span>' +
            '<span class="da-cta">Open →</span></button>';
        }).join('') + '</div>'
      : '') +

    '<div class="dcard dash-list-card">' +
      '<div class="dash-list-head"><h3>Dealer-wise balance</h3>' +
        '<div class="dash-legend"><span><i class="sw sw-dr"></i>Dr — dealer owes Horizon</span>' +
        '<span><i class="sw sw-cr"></i>Cr — Horizon owes dealer</span></div></div>' +
      '<div class="dlist js-list"><div class="muted">Loading…</div></div>' +
    '</div>';
}

function loadNetworkDashboard_(root) {
  if (!root.querySelector('.dash-top')) networkSkeleton_(root);

  api('getDashboardSummary', session.token).then(function (s) {
    var total = Number(s.totalOutstanding) || 0;
    root.querySelector('.js-total').innerHTML = drCr_(total);
    root.querySelector('.js-total-sub').textContent = total > 0.005
      ? 'Net amount dealers owe Horizon'
      : (total < -0.005 ? 'Net amount Horizon owes dealers' : 'All accounts settled');
    root.querySelector('.js-dealers').textContent = s.totalDealers;
    root.querySelector('.js-types').textContent =
      [['ASC', s.totalASC], ['AD', s.totalAD], ['FO', s.totalFO]]
        .filter(function (t) { return Number(t[1]) > 0; })
        .map(function (t) { return t[1] + ' ' + t[0]; }).join(' · ') || 'No dealers yet';
    var over = Number(s.dealersOverLimit) || 0;
    root.querySelector('.js-over').textContent = over;
    root.querySelector('.js-over-sub').innerHTML = over
      ? statusPill_('Red', over === 1 ? '1 dealer needs attention' : over + ' dealers need attention')
      : statusPill_('Green', 'Everyone within limit');
    root.querySelectorAll('.dash-action').forEach(function (btn) {
      var n = Number(s[ACTIONS[btn.getAttribute('data-action')].key]) || 0;
      btn.querySelector('.da-num').textContent = n;
      btn.classList.toggle('has-work', n > 0);
      btn.querySelector('.da-cta').textContent = n > 0 ? 'Open →' : 'All clear ✓';
    });
    root.querySelector('.js-asof').textContent = 'Updated ' + nowTime_();
  }).catch(function (err) { showToast_(err); });

  api('listDealerOutstandingSummary', session.token).then(function (rows) {
    renderDealerList_(root, rows || []);
  }).catch(function (err) { showToast_(err); });
}

function statusPill_(status, text) {
  var st = STATUS[status] || STATUS.Green;
  return '<span class="st ' + st.cls + '"><b>' + st.icon + '</b> ' + esc_(text || st.text) + '</span>';
}

function renderDealerList_(root, rows) {
  var list = root.querySelector('.js-list');
  var split = root.querySelector('.js-split');
  if (!rows.length) { list.innerHTML = '<div class="muted">No active dealers.</div>'; split.innerHTML = ''; return; }

  var drSum = 0, crSum = 0, drN = 0, crN = 0, max = 0;
  rows.forEach(function (r) {
    var v = Number(r.outstanding) || 0;
    if (v > 0.005) { drSum += v; drN++; } else if (v < -0.005) { crSum += -v; crN++; }
    max = Math.max(max, Math.abs(v));
  });
  split.innerHTML =
    '<div><i class="sw sw-dr"></i>Dealers owe Horizon <strong>' + rupees_(drSum) + '</strong>' +
      ' <span class="muted">· ' + drN + ' dealer' + (drN === 1 ? '' : 's') + '</span></div>' +
    '<div><i class="sw sw-cr"></i>Horizon owes dealers <strong>' + rupees_(crSum) + '</strong>' +
      ' <span class="muted">· ' + crN + ' dealer' + (crN === 1 ? '' : 's') + '</span></div>';

  // Both sides present: bars grow left (Cr) and right (Dr) from a centre
  // line. One side only: a plain left-anchored bar, so half the track isn't
  // left empty for a side nobody is on.
  var diverging = drN > 0 && crN > 0;

  list.innerHTML = rows.map(function (r, i) {
    var v = Number(r.outstanding) || 0;
    var share = max > 0 ? Math.abs(v) / max : 0;
    var side = v > 0.005 ? 'dr' : (v < -0.005 ? 'cr' : '');
    var bar = '';
    if (side) {
      var w = Math.max(share * (diverging ? 50 : 100), 0.6);
      var left = !diverging ? 0 : (side === 'dr' ? 50 : 50 - w);
      bar = '<div class="dbar dbar-' + side + (diverging ? ' dbar-div' : '') + '" style="left:' + left + '%;width:' + w + '%;"></div>';
    }
    var limit = Number(r.creditLimit);
    var limitNote = r.creditLimit === undefined ? ''
      : (limit > 0
        ? Math.max(0, Math.round(Number(r.usedPercent) || 0)) + '% of ' + rupees_(limit) + ' limit used'
        : 'No credit limit set');
    return '<div class="drow" data-i="' + i + '">' +
      '<div class="drow-name"><strong>' + esc_(r.dealerName) + '</strong>' +
        '<span class="muted">' + esc_(r.dealerCode || '') + (r.type ? ' · ' + esc_(r.type) : '') + '</span></div>' +
      '<div class="drow-bar"><div class="dbar-track' + (diverging ? ' dbar-track-div' : '') + '">' + bar + '</div></div>' +
      '<div class="drow-amt">' + drCr_(v) + '</div>' +
      '<div class="drow-status">' + statusPill_(r.status) +
        (limitNote ? '<span class="muted">' + limitNote + '</span>' : '') + '</div>' +
    '</div>';
  }).join('');

  bindTooltip_(list, rows);
}

// Hover detail for a dealer's row: exact balance and the credit position.
var tip = null;
function bindTooltip_(list, rows) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'dash-tip';
    document.body.appendChild(tip);
  }
  list.onmousemove = function (e) {
    var row = e.target.closest('.drow');
    if (!row) { tip.style.display = 'none'; return; }
    var r = rows[Number(row.getAttribute('data-i'))];
    var limit = Number(r.creditLimit) || 0;
    tip.innerHTML = '<strong>' + esc_(r.dealerName) + '</strong>' +
      '<div><span>Balance</span><b>' + drCr_(r.outstanding) + '</b></div>' +
      (r.creditLimit !== undefined
        ? '<div><span>Credit limit</span><b>' + (limit > 0 ? rupees_(limit) : 'Not set') + '</b></div>' +
          (limit > 0 ? '<div><span>Available</span><b>' + rupees_(Math.max(0, Number(r.availableBalance) || 0)) + '</b></div>' : '')
        : '');
    tip.style.display = 'block';
    var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    var y = e.clientY + 16 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  list.onmouseleave = function () { tip.style.display = 'none'; };
}

// ============================================================= DEALER ===
function loadDealerDashboard_(root) {
  if (!root.querySelector('.dash-top')) {
    var isAsc = String(session.dealerType || '').toUpperCase() === 'ASC';
    root.innerHTML =
      '<div class="dash-head"><h2>Welcome, ' + esc_(session.fullName || session.dealerCode) + '</h2>' +
        '<div class="dash-asof"><span class="muted js-asof"></span>' +
        '<button type="button" class="link-btn" onclick="loadDashboardSummary()">Refresh</button></div></div>' +
      '<div class="dash-top dash-top-dealer">' +
        '<div class="dcard dash-hero">' +
          '<div class="dash-label">Your balance</div>' +
          '<div class="dash-hero-value js-total">—</div>' +
          '<div class="dash-hero-sub js-total-sub"></div>' +
        '</div>' +
        '<div class="dcard dash-stat">' +
          '<div class="dash-label">Credit limit</div>' +
          '<div class="dash-stat-value js-limit">—</div>' +
          '<div class="meter"><div class="meter-fill js-meter"></div></div>' +
          '<div class="dash-stat-sub js-limit-sub"></div>' +
        '</div>' +
      '</div>' +
      '<div class="dash-section-title">Quick links</div>' +
      '<div class="dash-actions">' +
        '<button type="button" class="dash-action" onclick="goToPage(\'Ledger\')"><span class="da-num">☰</span>' +
          '<span class="da-label">Ledger — every bill, payment and balance</span><span class="da-cta">Open →</span></button>' +
        '<button type="button" class="dash-action js-pay" onclick="goToPage(\'Payments\')"><span class="da-num">—</span>' +
          '<span class="da-label">Payments waiting for approval</span><span class="da-cta">Open →</span></button>' +
        (isAsc ? '<button type="button" class="dash-action" onclick="goToPage(\'Commission\')"><span class="da-num">₹</span>' +
          '<span class="da-label">Commission — invoices and reports</span><span class="da-cta">Open →</span></button>' : '') +
      '</div>';
  }

  api('getCreditStatus', session.token, session.dealerCode).then(function (c) {
    var v = Number(c.outstanding) || 0;
    root.querySelector('.js-total').innerHTML = drCr_(v);
    root.querySelector('.js-total-sub').textContent = v > 0.005
      ? 'Amount you owe Horizon Auto'
      : (v < -0.005 ? 'Amount Horizon Auto owes you' : 'Your account is settled');
    var limit = Number(c.creditLimit) || 0;
    var meter = root.querySelector('.js-meter');
    if (limit > 0) {
      var used = Math.max(0, Number(c.usedPercent) || 0);
      root.querySelector('.js-limit').textContent = rupees_(limit);
      meter.style.width = Math.min(used, 100) + '%';
      meter.className = 'meter-fill js-meter ' + (STATUS[c.status] || STATUS.Green).cls;
      root.querySelector('.js-limit-sub').innerHTML = statusPill_(c.status) +
        ' <span class="muted">' + Math.round(used) + '% used · ' +
        rupees_(Math.max(0, Number(c.availableBalance) || 0)) + ' available</span>';
    } else {
      root.querySelector('.js-limit').textContent = 'Not set';
      meter.style.width = '0';
      root.querySelector('.js-limit-sub').innerHTML = '<span class="muted">No credit limit has been set for your account.</span>';
    }
    root.querySelector('.js-asof').textContent = 'Updated ' + nowTime_();
  }).catch(function (err) { showToast_(err); });

  api('getSidebarCounts', session.token).then(function (c) {
    var n = Number(c.Payments) || 0;
    var btn = root.querySelector('.js-pay');
    btn.querySelector('.da-num').textContent = n;
    btn.classList.toggle('has-work', n > 0);
    btn.querySelector('.da-cta').textContent = n > 0 ? 'Open →' : 'All clear ✓';
  }).catch(function () { /* count is a hint only */ });
}

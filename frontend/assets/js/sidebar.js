import { session } from './session.js';
import { showPage, dashboardPageForRole } from './router.js';
import { loadDashboardSummary } from './pages/dashboard.js';
import { loadDealers } from './pages/dealerMaster.js';
import { loadUsers } from './pages/userMaster.js';
import { loadLedger, loadDealerDropdowns } from './pages/ledger.js';
import { loadPayments } from './pages/payments.js';
import { loadReturns } from './pages/returns.js';
import { loadCommissionPage } from './pages/commission.js';
import { loadAuditLog } from './pages/auditLog.js';
import { loadVehicleSaleReviews } from './pages/vehicleSaleReview.js';
import { loadPartsSaleReviewQueue } from './pages/partsReview.js';
import { loadImportLog } from './pages/imports.js';
import { loadReview } from './pages/review.js';
import { loadBulkEntry } from './pages/bulkEntry.js';
import { api } from './api.js';

export function buildSidebar(role) {
  var links = {
    'Admin':            ['Dashboard', 'DealerMaster', 'UserMaster', 'Ledger', 'BulkEntry', 'Payments', 'Returns', 'Commission', 'VehicleSaleReview', 'PartsReview', 'Review', 'Imports', 'AuditLog'],
    'Network Manager':  ['Dashboard', 'DealerMaster', 'Ledger', 'Payments', 'Returns', 'Commission', 'VehicleSaleReview', 'Imports'],
    'Accounts':         ['Dashboard', 'DealerMaster', 'Ledger', 'BulkEntry', 'Payments', 'Returns', 'Commission', 'PartsReview', 'Imports'],
    'Dealer':           ['Dashboard', 'Ledger', 'Payments', 'Commission']
  };
  var labels = {
    Dashboard: 'Dashboard', DealerMaster: 'Dealer master', UserMaster: 'User master',
    Ledger: 'Ledger', Payments: 'Payments', Returns: 'Returns', Commission: 'Commission', AuditLog: 'Audit log',
    VehicleSaleReview: 'Vehicle sale review', PartsReview: 'Parts review', Imports: 'Imports',
    Review: 'Review', BulkEntry: 'Bulk entry'
  };

  // Commission sirf ASC dealers ko milta hai, isliye AD dealer ke sidebar se
  // wo tab hata dete hain — jo tab kabhi kaam ka na ho use dikhana confusion
  // hi banata hai. Yeh sirf UI hai: backend har commission call pe khud role
  // aur dealer check karta hai, to tab chhupa dene se security nahi aati.
  // Unknown/blank type ko bhi chhupa rahe hain — naya dealer jiska Type set
  // nahi hua, use galti se ASC maan lena bad default hoga.
  var visible = (links[role] || []).filter(function (name) {
    if (name !== 'Commission') return true;
    if (role !== 'Dealer') return true;
    return String(session.dealerType || '').trim().toUpperCase() === 'ASC';
  });

  var container = document.getElementById('sidebar-links');
  container.innerHTML = '';
  visible.forEach(function (name) {
    var a = document.createElement('a');
    a.href = '#';
    a.textContent = labels[name] || name;
    a.dataset.page = name;
    if (COUNTED_TABS[name]) {
      var pill = document.createElement('span');
      pill.className = 'nav-count';
      pill.id = 'nav-count-' + name;
      pill.textContent = '0';
      a.appendChild(pill);
    }
    a.onclick = function () {
      document.querySelectorAll('.sidebar a').forEach(function (el) { el.classList.remove('active'); });
      a.classList.add('active');
      var target = name === 'Dashboard' ? dashboardPageForRole(role) : name;
      showPage(target);
      if (name === 'Dashboard') loadDashboardSummary();
      if (name === 'DealerMaster') loadDealers();
      if (name === 'UserMaster') loadUsers();
      if (name === 'Ledger') {
        if (role === 'Dealer') loadLedger(session.dealerCode);
        else loadDealerDropdowns();
      }
      if (name === 'Payments') loadPayments();
      if (name === 'Returns') loadReturns();
      if (name === 'Commission') loadCommissionPage();
      if (name === 'AuditLog') loadAuditLog();
      if (name === 'VehicleSaleReview') loadVehicleSaleReviews();
      if (name === 'PartsReview') loadPartsSaleReviewQueue();
      if (name === 'Imports') loadImportLog();
      if (name === 'Review') loadReview();
      if (name === 'BulkEntry') loadBulkEntry();
      return false;
    };
    container.appendChild(a);
  });
  // Dashboard is the default landing page after login — mark it active immediately.
  var firstLink = container.querySelector('a[data-page="Dashboard"]');
  if (firstLink) firstLink.classList.add('active');
  refreshSidebarCounts();
}

// Tabs that carry a "things waiting for you" number. Always shown, 0 included,
// so a clean queue reads as clean rather than as a missing feature.
var COUNTED_TABS = { Payments: true, VehicleSaleReview: true, Review: true };

/**
 * Refreshes the numbers beside Payments, Vehicle sale review and Review.
 * Called after login and after any action that can change one of them.
 * A count that fails to load just keeps its previous value — it is a hint,
 * not something worth an error toast.
 */
export function refreshSidebarCounts() {
  if (!session.token) return;
  api('getSidebarCounts', session.token).then(function (c) {
    Object.keys(COUNTED_TABS).forEach(function (name) {
      var el = document.getElementById('nav-count-' + name);
      if (!el || c[name] === null || c[name] === undefined) return;
      el.textContent = c[name];
      el.classList.toggle('nav-count-zero', Number(c[name]) === 0);
    });
  }).catch(function () { /* hint only */ });
}
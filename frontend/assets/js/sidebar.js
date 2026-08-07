import { session } from './session.js';
import { showPage, dashboardPageForRole } from './router.js';
import { loadDashboardSummary } from './pages/dashboard.js';
import { loadDealers } from './pages/dealerMaster.js';
import { loadUsers } from './pages/userMaster.js';
import { loadLedger, loadDealerDropdowns } from './pages/ledger.js';
import { loadPayments } from './pages/payments.js';
import { loadReturns } from './pages/returns.js';
import { loadCommissionRules } from './pages/commission.js';
import { loadAuditLog } from './pages/auditLog.js';
import { loadVehicleSaleReviews } from './pages/vehicleSaleReview.js';
import { loadPartsSaleReviewQueue } from './pages/partsReview.js';
import { loadImportLog } from './pages/imports.js';

export function buildSidebar(role) {
  var links = {
    'Admin':            ['Dashboard', 'DealerMaster', 'UserMaster', 'Ledger', 'Payments', 'Returns', 'Commission', 'VehicleSaleReview', 'PartsReview', 'Imports', 'AuditLog'],
    'Network Manager':  ['Dashboard', 'DealerMaster', 'Ledger', 'Payments', 'Returns', 'VehicleSaleReview', 'Imports'],
    'Accounts':         ['Dashboard', 'DealerMaster', 'Ledger', 'Payments', 'Returns', 'Commission', 'PartsReview', 'Imports'],
    'Dealer':           ['Dashboard', 'Ledger', 'Payments']
  };
  var labels = {
    Dashboard: 'Dashboard', DealerMaster: 'Dealer master', UserMaster: 'User master',
    Ledger: 'Ledger', Payments: 'Payments', Returns: 'Returns', Commission: 'Commission', AuditLog: 'Audit log',
    VehicleSaleReview: 'Vehicle sale review', PartsReview: 'Parts review', Imports: 'Imports'
  };
  var container = document.getElementById('sidebar-links');
  container.innerHTML = '';
  (links[role] || []).forEach(function (name) {
    var a = document.createElement('a');
    a.href = '#';
    a.textContent = labels[name] || name;
    a.dataset.page = name;
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
      if (name === 'Commission') loadCommissionRules();
      if (name === 'AuditLog') loadAuditLog();
      if (name === 'VehicleSaleReview') loadVehicleSaleReviews();
      if (name === 'PartsReview') loadPartsSaleReviewQueue();
      if (name === 'Imports') loadImportLog();
      return false;
    };
    container.appendChild(a);
  });
  // Dashboard is the default landing page after login — mark it active immediately.
  var firstLink = container.querySelector('a[data-page="Dashboard"]');
  if (firstLink) firstLink.classList.add('active');
}

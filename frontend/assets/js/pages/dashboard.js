import { api } from '../api.js';
import { session } from '../session.js';
import { dashboardPageForRole } from '../router.js';
import { formatMoney_, showToast_, creditStatusBadge_ } from '../utils.js';

export function loadDashboardSummary() {
  var pageId = dashboardPageForRole(session.role);
  var container = document.getElementById('page-' + pageId);
  if (!container) return;
  api('getDashboardSummary', session.token).then(function (s) {
    setKpi_(container, 'total-dealers', s.totalDealers);
    setKpi_(container, 'total-outstanding', formatMoney_(s.totalOutstanding));
    setKpi_(container, 'over-limit', s.dealersOverLimit);
    setKpi_(container, 'pending-payments', s.pendingPayments);
    setKpi_(container, 'pending-returns', s.pendingReturns);
    setKpi_(container, 'pending-vsr', s.pendingVehicleSaleReviews);
    setKpi_(container, 'pending-psr', s.pendingPartsSaleReviews);
  }).catch(function (err) { showToast_(err); });

  var summaryBody = container.querySelector('#dashboard-dealer-summary-body');
  if (summaryBody) {
    api('listDealerOutstandingSummary', session.token).then(function (rows) {
      summaryBody.innerHTML = '';
      (rows || []).forEach(function (r) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + r.dealerName + '</td><td>' + formatMoney_(r.outstanding) + '</td><td>' + creditStatusBadge_(r.status) + '</td>';
        summaryBody.appendChild(tr);
      });
    }).catch(function (err) { showToast_(err); });
  }
}

function setKpi_(container, key, value) {
  var el = container.querySelector('.kpi-' + key);
  if (el) el.textContent = value;
}

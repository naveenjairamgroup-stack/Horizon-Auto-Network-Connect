/**
 * router.js
 * Minimal page-switching for this single-page app: every "page" is a div
 * (id="page-X") that's shown/hidden — no history/URL routing, matching the
 * original app's behaviour exactly.
 */

export function showPage(pageId) {
  document.querySelectorAll('.page').forEach(function (el) { el.style.display = 'none'; });
  var el = document.getElementById('page-' + pageId);
  if (el) el.style.display = 'block';
}

export function dashboardPageForRole(role) {
  if (role === 'Admin') return 'Dashboard_Admin';
  if (role === 'Network Manager') return 'Dashboard_NetworkManager';
  if (role === 'Accounts') return 'Dashboard_Accounts';
  return 'Dashboard_Dealer';
}

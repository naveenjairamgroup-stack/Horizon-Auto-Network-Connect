import { api } from './api.js';
import { session, setSession, clearSession, isLoggedIn, loadSession } from './session.js';
import { showPage, dashboardPageForRole } from './router.js';
import { buildSidebar } from './sidebar.js';
import { loadVoucherHeadOptions, loadLedger } from './pages/ledger.js';
import { loadDashboardSummary } from './pages/dashboard.js';

export function handleLogin(event) {
  event.preventDefault();
  var username = document.getElementById('login-username').value;
  var password = document.getElementById('login-password').value;
  var errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  api('login', username, password).then(onLoginSuccess).catch(function (err) {
    errorEl.textContent = err.message || String(err);
  });
}

function showMainUI() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('main-section').style.display = 'block';
  document.getElementById('navbar-username').textContent = session.fullName + ' (' + session.role + ')';
  buildSidebar(session.role);
  showPage(dashboardPageForRole(session.role));

  var canEditLedger = (session.role === 'Admin' || session.role === 'Accounts');
  document.getElementById('ledger-entry-card').style.display = canEditLedger ? 'block' : 'none';
  document.getElementById('opening-balance-card').style.display = canEditLedger ? 'block' : 'none';
  document.getElementById('ledger-dealer-picker').style.display = (session.role === 'Dealer') ? 'none' : 'flex';

  loadVoucherHeadOptions();
  loadDashboardSummary();
  if (session.role === 'Dealer') {
    loadLedger(session.dealerCode);
  }
}

export function initializeAuth() {
  if (!loadSession()) return;
  // Validate the stored token before showing the app. If it is expired or invalid,
  // clear the stored session and remain on the login page.
  api('getDashboardSummary', session.token).then(function () {
    showMainUI();
  }).catch(function () {
    clearSession();
  });
}

export function onLoginSuccess(result) {
  setSession(result); // {token, username, role, dealerCode, fullName}
  showMainUI();
}

export function handleLogout() {
  if (!isLoggedIn()) return;
  api('logout', session.token).finally(function () {
    clearSession();
    document.getElementById('main-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
  });
}

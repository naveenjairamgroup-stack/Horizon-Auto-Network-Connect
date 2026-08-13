/**
 * app.js
 * The single <script type="module"> entry point loaded by index.html.
 * Two jobs:
 *   1. Wire every <form>'s submit / <select>'s change listener once the
 *      DOM is ready (same as the old DOMContentLoaded block).
 *   2. Expose on `window` every function that a dynamically-generated
 *      onclick="..." attribute needs to find. ES modules do NOT put their
 *      exports in the global scope — only `window.X = X` does that — and
 *      since page tables are built via innerHTML with plain onclick
 *      strings (kept exactly as they were, to minimise behaviour risk in
 *      this migration), those functions must be reachable globally.
 */
import { handleLogin, handleLogout, initializeAuth } from './auth.js';
import { buildSidebar } from './sidebar.js';

import { loadDealers, handleCreateDealer, handleEditVehicleSaleAlias, handleEditInventoryAlias } from './pages/dealerMaster.js';
import { onUserRoleChange, handleCreateUser, handleResetPassword, handleToggleUser } from './pages/userMaster.js';
import {
  onLedgerDealerChange, handleAddLedgerEntry, handleSetOpeningBalance,
  openDetailModal, closeDetailModal, openInventoryDetailModal,
  handleFindLedgerCleanup, handleDeleteLedgerCleanup
} from './pages/ledger.js';
import { handleSubmitPayment, handleApprovePayment, handleRejectPayment } from './pages/payments.js';
import {
  handleSubmitReturn, handleApproveReturn, handleRejectReturn,
  onReturnTypeChange, addFrameNumberInput, removeFrameNumberInput
} from './pages/returns.js';
import { handleAddCommissionRule, handleCalculateCommission } from './pages/commission.js';
import {
  openVehicleSaleReviewForm, closeVehicleSaleReviewForm, handleSubmitVehicleSaleReview,
  onRegistrationTypeChange, onInsuranceTypeChange, onEwTypeChange
} from './pages/vehicleSaleReview.js';
import { handleAssignPartsSale } from './pages/partsReview.js';
import { handleImportNow } from './pages/imports.js';

// ---- Public surface for inline onclick="..." / onchange="..." handlers ---
// in the HTML (kept exactly as the original markup expects, to minimise
// behaviour risk in this migration) --------------------------------------
window.handleLogout = handleLogout;
window.handleEditVehicleSaleAlias = handleEditVehicleSaleAlias;
window.handleEditInventoryAlias = handleEditInventoryAlias;
window.handleResetPassword = handleResetPassword;
window.handleToggleUser = handleToggleUser;
window.onUserRoleChange = onUserRoleChange;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;
window.openInventoryDetailModal = openInventoryDetailModal;
window.handleApprovePayment = handleApprovePayment;
window.handleRejectPayment = handleRejectPayment;
window.handleApproveReturn = handleApproveReturn;
window.handleRejectReturn = handleRejectReturn;
window.onReturnTypeChange = onReturnTypeChange;
window.addFrameNumberInput = addFrameNumberInput;
window.removeFrameNumberInput = removeFrameNumberInput;
window.openVehicleSaleReviewForm = openVehicleSaleReviewForm;
window.closeVehicleSaleReviewForm = closeVehicleSaleReviewForm;
window.onRegistrationTypeChange = onRegistrationTypeChange;
window.onInsuranceTypeChange = onInsuranceTypeChange;
window.onEwTypeChange = onEwTypeChange;
window.handleAssignPartsSale = handleAssignPartsSale;
window.handleImportNow = handleImportNow;

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('new-dealer-form').addEventListener('submit', handleCreateDealer);
  document.getElementById('new-entry-form').addEventListener('submit', handleAddLedgerEntry);
  document.getElementById('opening-balance-form').addEventListener('submit', handleSetOpeningBalance);
  document.getElementById('ledger-dealer-select').addEventListener('change', onLedgerDealerChange);
  document.getElementById('new-payment-form').addEventListener('submit', handleSubmitPayment);
  document.getElementById('new-return-form').addEventListener('submit', handleSubmitReturn);
  document.getElementById('new-commission-rule-form').addEventListener('submit', handleAddCommissionRule);
  document.getElementById('calc-commission-form').addEventListener('submit', handleCalculateCommission);
  document.getElementById('new-user-form').addEventListener('submit', handleCreateUser);
  document.getElementById('vsr-form').addEventListener('submit', handleSubmitVehicleSaleReview);
  document.getElementById('cleanup-find-btn').addEventListener('click', handleFindLedgerCleanup);
  document.getElementById('cleanup-delete-btn').addEventListener('click', handleDeleteLedgerCleanup);
  initializeAuth();
});

// Exported purely so sidebar.js's import of buildSidebar resolves cleanly
// if something else ever needs it from here too; sidebar.js is the real
// owner of the implementation.
export { buildSidebar };

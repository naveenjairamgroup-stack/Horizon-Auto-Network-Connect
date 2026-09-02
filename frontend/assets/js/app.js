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
import {
  showCommissionTab, loadCommissionReports, openCommissionDetail, closeCommissionDetail,
  regenerateCommission, requestCommissionInvoiceNow,
  openCommissionUpload, closeCommissionUpload, handleCommissionUpload,
  openCommissionVerify, closeCommissionVerify, handleCommissionVerify,
  runCommissionCheckpointNow, generateOneCommission, generateAllCommission,
  renderCommissionRates, openCommissionRateForm, closeCommissionRateForm,
  handleSaveCommissionRate, showCommissionRateHistory, unlockCommissionPin,
  handleSaveCommissionConfig, handleSetCommissionPin,
  openCommissionInvoice, closeCommissionInvoice, handleSaveCommissionInvoice,
  printCommissionInvoice, downloadCommissionPdf
} from './pages/commission.js';
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

// ---- Commission tab ----
window.showCommissionTab = showCommissionTab;
window.loadCommissionReports = loadCommissionReports;
window.openCommissionDetail = openCommissionDetail;
window.closeCommissionDetail = closeCommissionDetail;
window.regenerateCommission = regenerateCommission;
window.requestCommissionInvoiceNow = requestCommissionInvoiceNow;
window.openCommissionUpload = openCommissionUpload;
window.closeCommissionUpload = closeCommissionUpload;
window.openCommissionVerify = openCommissionVerify;
window.closeCommissionVerify = closeCommissionVerify;
window.runCommissionCheckpointNow = runCommissionCheckpointNow;
window.generateOneCommission = generateOneCommission;
window.generateAllCommission = generateAllCommission;
window.renderCommissionRates = renderCommissionRates;
window.openCommissionRateForm = openCommissionRateForm;
window.closeCommissionRateForm = closeCommissionRateForm;
window.showCommissionRateHistory = showCommissionRateHistory;
window.unlockCommissionPin = unlockCommissionPin;
window.openCommissionInvoice = openCommissionInvoice;
window.closeCommissionInvoice = closeCommissionInvoice;
window.printCommissionInvoice = printCommissionInvoice;
window.downloadCommissionPdf = downloadCommissionPdf;

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('new-dealer-form').addEventListener('submit', handleCreateDealer);
  document.getElementById('new-entry-form').addEventListener('submit', handleAddLedgerEntry);
  document.getElementById('opening-balance-form').addEventListener('submit', handleSetOpeningBalance);
  document.getElementById('ledger-dealer-select').addEventListener('change', onLedgerDealerChange);
  document.getElementById('new-payment-form').addEventListener('submit', handleSubmitPayment);
  document.getElementById('new-return-form').addEventListener('submit', handleSubmitReturn);
  document.getElementById('cm-rate-form').addEventListener('submit', handleSaveCommissionRate);
  document.getElementById('cm-config-form').addEventListener('submit', handleSaveCommissionConfig);
  document.getElementById('cm-pin-set-form').addEventListener('submit', handleSetCommissionPin);
  document.getElementById('cm-upload-form').addEventListener('submit', handleCommissionUpload);
  document.getElementById('cm-verify-form').addEventListener('submit', handleCommissionVerify);
  document.getElementById('cm-invoice-form').addEventListener('submit', handleSaveCommissionInvoice);
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

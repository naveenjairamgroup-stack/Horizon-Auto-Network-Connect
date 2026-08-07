/**
 * RoleService.gs
 * Central permission matrix — see architecture doc, section 4.
 * hasAccess() / PERMISSIONS is the single place every service checks
 * before acting, so the rule lives in exactly one place.
 */

if (typeof ROLES === 'undefined') {
  var ROLES = {
    ADMIN: 'Admin',
    NETWORK_MANAGER: 'Network Manager',
    ACCOUNTS: 'Accounts',
    DEALER: 'Dealer'
  };
}

var PERMISSIONS = {
  DealerMaster:   { view: [ROLES.ADMIN, ROLES.NETWORK_MANAGER, ROLES.ACCOUNTS], edit: [ROLES.ADMIN] },
  UserMaster:     { view: [ROLES.ADMIN], edit: [ROLES.ADMIN] },
  Ledger:         { view: [ROLES.ADMIN, ROLES.NETWORK_MANAGER, ROLES.ACCOUNTS, ROLES.DEALER], edit: [ROLES.ADMIN, ROLES.ACCOUNTS] },
  OpeningBalance: { view: [ROLES.ADMIN, ROLES.ACCOUNTS], edit: [ROLES.ADMIN, ROLES.ACCOUNTS] },
  VoucherHead:    { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER], edit: [ROLES.ADMIN] },
  AuditLog:       { view: [ROLES.ADMIN], edit: [] },
  Payments:       { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER],
                    submit: [ROLES.DEALER, ROLES.NETWORK_MANAGER, ROLES.ADMIN],
                    approve: [ROLES.ACCOUNTS, ROLES.ADMIN] },
  Returns:        { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER],
                    submit: [ROLES.DEALER, ROLES.NETWORK_MANAGER, ROLES.ADMIN, ROLES.ACCOUNTS],
                    approve: [ROLES.NETWORK_MANAGER, ROLES.ADMIN] },
  Commission:     { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER], edit: [ROLES.ADMIN] },
  CreditControl:  { view: [ROLES.ADMIN, ROLES.ACCOUNTS], edit: [ROLES.ADMIN, ROLES.ACCOUNTS] },
  Import:         { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER], run: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER] },
  VehicleSaleReview: { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER], submit: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER] },
  PartsSaleReview:   { view: [ROLES.ADMIN, ROLES.ACCOUNTS], assign: [ROLES.ADMIN] },
  Inventory:         { view: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NETWORK_MANAGER, ROLES.DEALER] }
};

function hasAccess(role, module, action) {
  var rule = PERMISSIONS[module];
  if (!rule || !rule[action]) return false;
  return rule[action].indexOf(role) !== -1;
}

import { api } from '../api.js';
import { session } from '../session.js';
import { showToast_ } from '../utils.js';

export function onUserRoleChange() {
  var role = document.getElementById('nu-role').value;
  document.getElementById('nu-dealer-code-block').style.display = role === 'Dealer' ? 'block' : 'none';
}

export function loadUsers() {
  api('listUsers', session.token).then(function (users) {
    var tbody = document.getElementById('user-table-body');
    tbody.innerHTML = '';
    (users || []).forEach(function (u) {
      var tr = document.createElement('tr');
      var isActive = String(u.Active) === 'true';
      var toggleLabel = isActive ? 'Deactivate' : 'Activate';
      tr.innerHTML = '<td>' + u.Username + '</td><td>' + u['Full Name'] + '</td><td>' + u.Role + '</td>' +
        '<td>' + (u['Dealer Code'] || '') + '</td><td>' + (isActive ? 'Yes' : 'No') + '</td>' +
        '<td><button onclick="handleToggleUser(\'' + u.Username + '\', ' + (!isActive) + ')">' + toggleLabel + '</button> ' +
        '<button onclick="handleResetPassword(\'' + u.Username + '\')">Reset password</button></td>';
      tbody.appendChild(tr);
    });
  }).catch(function (err) { showToast_(err); });
}

export function handleResetPassword(username) {
  var custom = window.prompt('Custom temporary password de sakte ho (blank chhodo to system khud generate kar dega):', '');
  if (custom === null) return; // cancelled
  api('resetPassword', session.token, username, custom || '').then(function (result) {
    window.alert(
      'Password reset ho gaya.\n\n' +
      'Username: ' + result.username + '\n' +
      'Naya password: ' + result.newPassword + '\n\n' +
      'Ise abhi note/copy kar lo aur user ko bata do \u2014 yeh dobara kahin nahi dikhega.'
    );
  }).catch(function (err) { showToast_(err); });
}

export function handleCreateUser(event) {
  event.preventDefault();
  var user = {
    'Username':     document.getElementById('nu-username').value,
    'Full Name':    document.getElementById('nu-fullname').value,
    'Role':         document.getElementById('nu-role').value,
    'Dealer Code':  document.getElementById('nu-dealer-code').value
  };
  var tempPassword = document.getElementById('nu-temp-password').value || 'Welcome@123';
  api('createUser', session.token, user, tempPassword).then(function () {
    showToast_(null, 'User created. Temporary password: ' + tempPassword);
    document.getElementById('new-user-form').reset();
    loadUsers();
  }).catch(function (err) { showToast_(err); });
}

export function handleToggleUser(username, active) {
  api('setUserActive', session.token, username, active).then(function () {
    showToast_(null, 'Updated.');
    loadUsers();
  }).catch(function (err) { showToast_(err); });
}

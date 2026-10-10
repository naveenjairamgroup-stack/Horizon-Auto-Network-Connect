/**
 * SettingsService.gs
 * Small key/value settings that Admin changes from the UI, stored in the
 * App_Settings tab. Each key has a default (normally a constant in
 * Config.gs), so the system works before anyone opens the settings screen.
 *
 * Kept deliberately generic: a new setting is one entry in SETTING_DEFS
 * below, and it appears on the settings screen automatically.
 */

var SETTING_DEFS = {
  MAIL_SENDER_NAME: {
    label: 'Sender name', group: 'Commission email', type: 'text',
    hint: 'Name shown in the inbox. The underlying address is always the Google account that owns the script.',
    fallback: function () { return COMMISSION_EMAIL_SENDER_NAME; }
  },
  MAIL_EXTRA_TO: {
    label: 'Extra To', group: 'Commission email', type: 'emails',
    hint: 'Sent to in addition to the dealer\'s own email. Comma separated.',
    fallback: function () { return ''; }
  },
  MAIL_CC: {
    label: 'CC', group: 'Commission email', type: 'emails',
    hint: 'Copied on every invoice request and every uploaded-invoice reply.',
    fallback: function () { return COMMISSION_EMAIL_CC.join(', '); }
  },
  MAIL_REPLY_TO: {
    label: 'Reply-To', group: 'Commission email', type: 'emails',
    hint: 'Where a plain "Reply" from the dealer goes. Leave blank to use the CC list.',
    fallback: function () { return ''; }
  },
  PORTAL_URL: {
    label: 'Portal link', group: 'Commission email', type: 'text',
    hint: 'The "Open the portal" button in emails.',
    fallback: function () { return COMMISSION_PORTAL_URL; }
  },
  DRIVE_IMPORT_ENABLED: {
    label: 'Drive folder auto-import', group: 'Imports', type: 'bool',
    hint: 'Off: files are imported only by uploading them in the Imports tab. On: the old twice-daily Drive folder import also runs.',
    fallback: function () { return 'false'; }
  }
};

function getSetting_(key) {
  var def = SETTING_DEFS[key];
  var row = null;
  // Until setupDatabase() has created App_Settings, every setting is its default.
  try { row = findRow(SHEETS.APP_SETTINGS, 'Key', key); } catch (e) { row = null; }
  if (row && String(row.Value) !== '') return String(row.Value);
  return def ? String(def.fallback()) : '';
}

/** "a@x.in, b@y.in;c@z.in" -> ['a@x.in','b@y.in','c@z.in'] */
function splitEmails_(value) {
  return String(value || '').split(/[,;\s]+/).map(function (e) { return e.trim(); }).filter(Boolean);
}

function listSettings(token) {
  return safeRun('listSettings', function () {
    requireRole_(token, [ROLES.ADMIN]);
    return Object.keys(SETTING_DEFS).map(function (key) {
      var def = SETTING_DEFS[key];
      var row = findRow(SHEETS.APP_SETTINGS, 'Key', key);
      return {
        key: key, label: def.label, group: def.group, type: def.type, hint: def.hint,
        value: getSetting_(key),
        isDefault: !(row && String(row.Value) !== ''),
        updatedOn: row ? row['Updated On'] : '', updatedBy: row ? row['Updated By'] : ''
      };
    });
  });
}

function saveSetting(token, key, value) {
  return safeRun('saveSetting', function () {
    var session = requireRole_(token, [ROLES.ADMIN]);
    var def = SETTING_DEFS[key];
    if (!def) throw new Error('Unknown setting: ' + key);
    var v = String(value === null || value === undefined ? '' : value).trim();

    if (def.type === 'emails' && v) {
      var bad = splitEmails_(v).filter(function (e) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
      if (bad.length) throw new Error('Not a valid email address: ' + bad.join(', '));
      v = splitEmails_(v).join(', ');
    }
    if (def.type === 'bool') v = (v === 'true' || v === true) ? 'true' : 'false';

    var existing = findRow(SHEETS.APP_SETTINGS, 'Key', key);
    if (existing) {
      updateRowWhere(SHEETS.APP_SETTINGS, 'Key', key, { 'Value': v, 'Updated On': new Date(), 'Updated By': session.username }, session.username);
    } else {
      appendRow(SHEETS.APP_SETTINGS, { 'Key': key, 'Value': v, 'Updated On': new Date(), 'Updated By': session.username }, session.username);
    }
    return { key: key, value: v };
  });
}

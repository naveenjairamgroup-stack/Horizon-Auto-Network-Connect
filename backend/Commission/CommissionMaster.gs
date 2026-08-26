/**
 * CommissionMaster.gs
 * The two reference tables behind the commission calculation, plus the PIN
 * gate that protects rate edits.
 *
 * ---------------------------------------------------------------------
 * WHY BOTH TABLES ARE APPEND-ONLY
 * ---------------------------------------------------------------------
 * Neither Commission_Rate_Master nor Commission_Config is ever edited in
 * place. Changing a rate writes a NEW row with a new "Effective From"; the
 * previous row stays exactly where it was. Two reasons:
 *
 *   1. History. Six months from now, "what was ACTIVA's rate in July?" is
 *      answerable by reading the sheet, without an audit-log archaeology dig.
 *   2. Safety. An in-place edit of a financial rate is a single un-undoable
 *      keystroke. An append is not.
 *
 * The rate that APPLIES is the newest row whose Effective From has already
 * passed. That is deliberately "latest wins", not "whatever was in force on
 * the sale date" — confirmed as the intended behaviour: an unposted month
 * recalculates at the newest rate. Once a month is posted to the ledger it is
 * frozen, so a later rate change can never disturb it.
 * ---------------------------------------------------------------------
 */

// ============================================================ RATE LOOKUP =
/**
 * The commission amount for one Model Variant, or null if that variant has no
 * rate on file yet. Returning null rather than 0 is the whole point: 0 would
 * silently under-pay the ASC, whereas null lets the checkpoint stop and say
 * "this variant needs a rate" — which is exactly the failure that cost SAI
 * nine vehicles' commission in the spreadsheet this replaces.
 *
 * Matching goes through normalizeModelVariant_ (shared with the Stock import),
 * so "ACTIVA DLX-OBD2B" and "ACTIVA DLX OBD2B" are the same variant.
 */
function lookupCommissionRate_(modelVariant, ratesByVariant) {
  var key = normalizeModelVariant_(modelVariant);
  if (!key) return null;
  var map = ratesByVariant || buildCommissionRateMap_();
  var hit = map[key];
  return hit ? Number(hit['Commission Amount']) : null;
}

/**
 * Builds { normalizedVariant -> winning rate row } in one pass, so a report of
 * 200 frames does one sheet read instead of 200 scans. Only rows whose
 * Effective From has already passed are eligible; among those the newest wins.
 */
function buildCommissionRateMap_() {
  var rows = getAllRows(SHEETS.COMMISSION_RATE_MASTER);
  var now = new Date();
  var map = {};
  rows.forEach(function (r) {
    var key = normalizeModelVariant_(r['Model Variant']);
    if (!key) return;
    var eff = parseInvoiceDate_(r['Effective From']);
    if (eff > now) return; // scheduled for the future — not in force yet
    var current = map[key];
    if (!current || eff >= parseInvoiceDate_(current['Effective From'])) {
      map[key] = r;
    }
  });
  return map;
}

// ========================================================== CONFIG LOOKUP =
/**
 * Resolves one config value. A row whose Scope matches the dealer code wins
 * over the blank-Scope (all-dealers) row — that is how RAJ and SAI get 6.5%
 * insurance commission while every other ASC gets 13%, without either number
 * being written into the code.
 *
 * Returns fallback if nothing is configured at all, so a fresh install still
 * calculates sensibly before anyone visits the config screen.
 */
function lookupCommissionConfig_(key, dealerCode, fallback) {
  var rows = getAllRows(SHEETS.COMMISSION_CONFIG);
  var now = new Date();
  var best = null;
  var bestIsScoped = false;

  rows.forEach(function (r) {
    if (String(r['Config Key']).trim() !== key) return;
    var scope = String(r.Scope || '').trim();
    var isScoped = scope !== '';
    if (isScoped && scope !== String(dealerCode || '')) return; // another dealer's override
    var eff = parseInvoiceDate_(r['Effective From']);
    if (eff > now) return;

    // A scoped row always beats an unscoped one. Between two rows of the same
    // kind, the newer Effective From wins.
    if (!best) { best = r; bestIsScoped = isScoped; return; }
    if (isScoped && !bestIsScoped) { best = r; bestIsScoped = true; return; }
    if (isScoped === bestIsScoped && eff >= parseInvoiceDate_(best['Effective From'])) { best = r; }
  });

  return best ? Number(best.Value) : fallback;
}

// =============================================================== PIN GATE =
/**
 * A single shared PIN, stored hashed (never in plain text) in Script
 * Properties. It is not a second login — it is a "you are about to change a
 * money number, stop and confirm" speed bump on top of the role check, which
 * is why one PIN for everyone is enough. Admin sets and resets it.
 */
function isCommissionPinSet_() {
  return !!PropertiesService.getScriptProperties().getProperty('COMMISSION_PIN_HASH');
}

function setCommissionPin(token, newPin) {
  return safeRun('setCommissionPin', function () {
    var session = requireRole_(token, [ROLES.ADMIN]);
    var pin = String(newPin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) {
      throw new Error('PIN must be 4 to 8 digits.');
    }
    var props = PropertiesService.getScriptProperties();
    var salt = Utilities.getUuid();
    props.setProperty('COMMISSION_PIN_SALT', salt);
    props.setProperty('COMMISSION_PIN_HASH', hashPassword_(pin, salt));
    // The PIN itself is never logged — only the fact that it changed.
    logAction(session.username, 'COMMISSION PIN SET', '', 'PIN updated');
    return true;
  });
}

/** Whether a PIN exists yet, and whether this session is currently unlocked. Drives the UI. */
function getCommissionPinStatus(token) {
  return safeRun('getCommissionPinStatus', function () {
    requireRole_(token, PERMISSIONS.Commission.view);
    return { pinSet: isCommissionPinSet_(), unlocked: isCommissionPinUnlocked_(token) };
  });
}

/**
 * Verifies the PIN and unlocks rate editing for this session for
 * COMMISSION_PIN_UNLOCK_MINUTES, so a run of edits doesn't demand the PIN on
 * every single row. The unlock is keyed to the session token, so it dies with
 * the session and never leaks to another user.
 */
function verifyCommissionPin(token, pin) {
  return safeRun('verifyCommissionPin', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.editRates);
    if (!isCommissionPinSet_()) {
      throw new Error('No commission PIN has been set yet. Ask Admin to set one first.');
    }
    var props = PropertiesService.getScriptProperties();
    var salt = props.getProperty('COMMISSION_PIN_SALT');
    if (hashPassword_(String(pin || ''), salt) !== props.getProperty('COMMISSION_PIN_HASH')) {
      throw new Error('Incorrect PIN.');
    }
    CacheService.getScriptCache().put(commissionPinCacheKey_(token), '1', COMMISSION_PIN_UNLOCK_MINUTES * 60);
    logAction(session.username, 'COMMISSION PIN UNLOCK', '', 'Unlocked for ' + COMMISSION_PIN_UNLOCK_MINUTES + ' minutes');
    return { unlocked: true, minutes: COMMISSION_PIN_UNLOCK_MINUTES };
  });
}

function commissionPinCacheKey_(token) {
  return 'commission-pin-unlock:' + token;
}

function isCommissionPinUnlocked_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(commissionPinCacheKey_(token)) === '1';
}

/** Throws unless this session unlocked the PIN within the window. Every rate write calls this. */
function requireCommissionPin_(token) {
  if (!isCommissionPinSet_()) {
    throw new Error('No commission PIN has been set yet. Ask Admin to set one before editing rates.');
  }
  if (!isCommissionPinUnlocked_(token)) {
    throw new Error('PIN required. Enter the commission PIN to unlock editing.');
  }
}

// ========================================================= RATE MASTER API =
/**
 * The rate list as the UI shows it: one row per Model Variant (the one
 * currently in force), plus how many historical rows sit behind it.
 * Alphabetical, because that is how someone hunting for a specific variant
 * will scan it.
 */
function listCommissionRates(token) {
  return safeRun('listCommissionRates', function () {
    requireRole_(token, PERMISSIONS.Commission.view);
    var rows = getAllRows(SHEETS.COMMISSION_RATE_MASTER);
    var byVariant = {};
    rows.forEach(function (r) {
      var key = normalizeModelVariant_(r['Model Variant']);
      if (!key) return;
      if (!byVariant[key]) byVariant[key] = [];
      byVariant[key].push(r);
    });

    var now = new Date();
    var out = Object.keys(byVariant).map(function (key) {
      var list = byVariant[key].slice().sort(function (a, b) {
        return parseInvoiceDate_(b['Effective From']) - parseInvoiceDate_(a['Effective From']);
      });
      var inForce = null;
      for (var i = 0; i < list.length; i++) {
        if (parseInvoiceDate_(list[i]['Effective From']) <= now) { inForce = list[i]; break; }
      }
      var display = inForce || list[0];
      return {
        modelVariant: display['Model Variant'],
        amount: Number(display['Commission Amount']) || 0,
        effectiveFrom: display['Effective From'],
        pendingFuture: !inForce,          // every row is future-dated — nothing in force yet
        historyCount: list.length,
        updatedBy: display['Created By'] || '',
        updatedOn: display['Created On'] || ''
      };
    });

    out.sort(function (a, b) {
      var av = String(a.modelVariant).toUpperCase(), bv = String(b.modelVariant).toUpperCase();
      return av === bv ? 0 : (av < bv ? -1 : 1);
    });
    return out;
  });
}

/** Every rate ever set for one variant, newest first — the "history" popup. */
function getCommissionRateHistory(token, modelVariant) {
  return safeRun('getCommissionRateHistory', function () {
    requireRole_(token, PERMISSIONS.Commission.view);
    var key = normalizeModelVariant_(modelVariant);
    return getAllRows(SHEETS.COMMISSION_RATE_MASTER)
      .filter(function (r) { return normalizeModelVariant_(r['Model Variant']) === key; })
      .sort(function (a, b) { return parseInvoiceDate_(b['Effective From']) - parseInvoiceDate_(a['Effective From']); });
  });
}

/**
 * Adds a variant, or changes an existing variant's rate — both are the same
 * operation (append a row), which is why there is one function rather than a
 * create and an update. PIN-gated.
 *
 * The guard against an identical duplicate (same variant, same date, same
 * amount) exists because a double-clicked Save would otherwise leave two
 * indistinguishable rows in a financial reference table.
 */
function saveCommissionRate(token, modelVariant, amount, effectiveFrom) {
  return safeRun('saveCommissionRate', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.editRates);
    requireCommissionPin_(token);

    var variant = sanitizeString(modelVariant).toUpperCase();
    if (!variant) throw new Error('Model Variant is required.');
    var value = Number(amount);
    if (!isFinite(value) || value < 0) throw new Error('Commission amount must be a number of 0 or more.');
    if (!effectiveFrom) throw new Error('Effective From date is required.');
    var eff = parseInvoiceDate_(effectiveFrom);

    var existing = getAllRows(SHEETS.COMMISSION_RATE_MASTER).filter(function (r) {
      return normalizeModelVariant_(r['Model Variant']) === normalizeModelVariant_(variant);
    });
    var duplicate = existing.some(function (r) {
      return Number(r['Commission Amount']) === value &&
        Utilities.formatDate(parseInvoiceDate_(r['Effective From']), 'Asia/Kolkata', 'yyyy-MM-dd') ===
        Utilities.formatDate(eff, 'Asia/Kolkata', 'yyyy-MM-dd');
    });
    if (duplicate) {
      throw new Error('This exact rate and effective date is already saved for ' + variant + '.');
    }

    appendRow(SHEETS.COMMISSION_RATE_MASTER, {
      'Model Variant': variant,
      'Commission Amount': value,
      'Effective From': eff,
      'Created On': new Date(),
      'Created By': session.username
    }, session.username);

    return { modelVariant: variant, amount: value, isNew: existing.length === 0 };
  });
}

// ============================================================= CONFIG API =
/** Current value of every config key, with any per-dealer overrides listed alongside. Admin screen. */
function listCommissionConfig(token) {
  return safeRun('listCommissionConfig', function () {
    requireRole_(token, PERMISSIONS.Commission.view);
    var rows = getAllRows(SHEETS.COMMISSION_CONFIG);
    var keys = [
      COMMISSION_CONFIG_KEYS.REGISTRATION_COMMISSION,
      COMMISSION_CONFIG_KEYS.INSURANCE_COMMISSION_PCT,
      COMMISSION_CONFIG_KEYS.SGST_PCT,
      COMMISSION_CONFIG_KEYS.CGST_PCT
    ];
    return keys.map(function (key) {
      var overrides = rows
        .filter(function (r) { return String(r['Config Key']).trim() === key && String(r.Scope || '').trim() !== ''; })
        .map(function (r) { return { scope: String(r.Scope).trim(), value: Number(r.Value), effectiveFrom: r['Effective From'] }; });

      // Collapse to the winning override per dealer, so the screen shows the
      // value actually in use rather than every historical row.
      var latestByScope = {};
      overrides.forEach(function (o) {
        var cur = latestByScope[o.scope];
        if (!cur || parseInvoiceDate_(o.effectiveFrom) >= parseInvoiceDate_(cur.effectiveFrom)) latestByScope[o.scope] = o;
      });

      return {
        key: key,
        defaultValue: lookupCommissionConfig_(key, '', null),
        overrides: Object.keys(latestByScope).map(function (s) { return latestByScope[s]; })
      };
    });
  });
}

/** Admin-only, no PIN (per spec). Scope blank = the all-dealers default; a Dealer Code = an override for that dealer. */
function setCommissionConfig(token, key, scope, value, effectiveFrom) {
  return safeRun('setCommissionConfig', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.editConfig);
    var validKeys = Object.keys(COMMISSION_CONFIG_KEYS).map(function (k) { return COMMISSION_CONFIG_KEYS[k]; });
    if (validKeys.indexOf(key) === -1) throw new Error('Unknown config key: ' + key);
    var num = Number(value);
    if (!isFinite(num) || num < 0) throw new Error('Value must be a number of 0 or more.');
    var scopeClean = String(scope || '').trim().toUpperCase();
    if (scopeClean && !findRow(SHEETS.DEALER_MASTER, 'Dealer Code', scopeClean)) {
      throw new Error('Dealer not found: ' + scopeClean);
    }
    appendRow(SHEETS.COMMISSION_CONFIG, {
      'Config Key': key,
      'Scope': scopeClean,
      'Value': num,
      'Effective From': effectiveFrom ? parseInvoiceDate_(effectiveFrom) : new Date(),
      'Created On': new Date(),
      'Created By': session.username
    }, session.username);
    return true;
  });
}

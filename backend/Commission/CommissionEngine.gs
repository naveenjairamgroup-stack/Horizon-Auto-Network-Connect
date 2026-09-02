/**
 * CommissionEngine.gs
 * Network commission payable to ASC dealers on the vehicles they sell.
 *
 * ---------------------------------------------------------------------
 * WHAT IS BEING CALCULATED
 * ---------------------------------------------------------------------
 * One row per FRAME (not per invoice), exactly mirroring the spreadsheet
 * this replaces. Three components add up per frame:
 *
 *   Vehicle commission  Model Variant -> Commission_Rate_Master
 *   Registration        a flat amount, ONLY when Registration Type is
 *                       'Permanent Registration' (TR Only / No Registration
 *                       earn nothing)
 *   Insurance           (Insurance Amount / 1.18) x rate%, where the rate is
 *                       13% for most ASCs and 6.5% for the ones configured
 *                       with an override. Zero premium earns zero.
 *
 * Then, per ASC per month:
 *   Taxable        = sum of all frame totals   (decimals kept)
 *   SGST + CGST    = 9% each of Taxable
 *   Invoice Amount = round(Taxable x 1.18)     (whole rupees — this is the
 *                    figure the ASC's tax invoice must show)
 *
 * Rounding happens ONCE, on the final invoice amount. Rounding each frame
 * would drift away from the ASC's own arithmetic by a few rupees a month.
 *
 * ---------------------------------------------------------------------
 * WHERE THE DATA COMES FROM
 * ---------------------------------------------------------------------
 *   Vehicle_Sale_Review_Queue   Status = 'Submitted' only. Registration and
 *   (per invoice)               Insurance figures live here, entered by the
 *                               Network Manager. 'Pending' rows haven't been
 *                               filled in yet; 'Cancelled' rows are excluded
 *                               automatically, which is why cancelled sales
 *                               need no special handling anywhere below.
 *   Vehicle_Sale_Detail         Frame No and Model Variant, Source = 'ASC'.
 *   (per frame)
 *
 * A frame belongs to a month by its INVOICE DATE, never by when it was
 * imported — a late import lands in the month it was actually sold in.
 *
 * ---------------------------------------------------------------------
 * THE LIFECYCLE, AND WHY IT IS ONE-WAY
 * ---------------------------------------------------------------------
 *   Generated -> Invoice Requested -> Invoice Uploaded -> Posted
 *
 * Regeneration is permitted ONLY in Generated. The moment an ASC has been
 * asked for an invoice, the figures it is invoicing against must stop moving
 * underneath it. And once Posted, the month is closed permanently: a frame
 * that arrives afterwards is ignored rather than quietly reopening a month
 * that Accounts has already put through Tally.
 * ---------------------------------------------------------------------
 */

// ============================================================ COLLECTION =
/**
 * Every commissionable frame for one ASC in one month, already priced.
 * Returns { lines, missingVariants, multiFrameInvoices }.
 *
 * missingVariants is the important output: any frame whose Model Variant has
 * no rate on file yet is reported rather than silently priced at zero. That
 * single behaviour is what the month-start checkpoint is built around.
 */
function collectCommissionLines_(dealerCode, month, rateMap) {
  var queueRows = getAllRows(SHEETS.VEHICLE_SALE_REVIEW_QUEUE).filter(function (q) {
    if (String(q['Dealer Code']) !== String(dealerCode)) return false;
    if (String(q.Status) !== 'Submitted') return false;
    if (!q['Invoice Date']) return false;
    return Utilities.formatDate(parseInvoiceDate_(q['Invoice Date']), 'Asia/Kolkata', 'yyyy-MM') === month;
  });

  var allDetail = getAllRows(SHEETS.VEHICLE_SALE_DETAIL);
  var detailByInvoice = {};
  allDetail.forEach(function (d) {
    if (String(d.Source) !== 'ASC') return;
    if (String(d['Dealer Code']) !== String(dealerCode)) return;
    var inv = String(d['Invoice No']);
    if (!detailByInvoice[inv]) detailByInvoice[inv] = [];
    detailByInvoice[inv].push(d);
  });

  var regCommission = lookupCommissionConfig_(COMMISSION_CONFIG_KEYS.REGISTRATION_COMMISSION, dealerCode, 500);
  var insPct = lookupCommissionConfig_(COMMISSION_CONFIG_KEYS.INSURANCE_COMMISSION_PCT, dealerCode, 13);

  var lines = [];
  var missingVariants = {};
  var multiFrameInvoices = [];

  queueRows.forEach(function (q) {
    var invoiceNo = String(q['Invoice No']);
    var frames = detailByInvoice[invoiceNo] || [];
    if (frames.length === 0) return; // submitted review with no frame detail — nothing to price
    if (frames.length > 1) multiFrameInvoices.push(invoiceNo);

    var invoiceDate = parseInvoiceDate_(q['Invoice Date']);
    var isPermanent = String(q['Registration Type']).trim() === COMMISSION_REGISTRATION_TYPE;
    var insuranceAmount = parseAmount_(q['Insurance Amount']);

    frames.forEach(function (f, idx) {
      var variant = f['Model Variant'];
      var vehicleCom = lookupCommissionRate_(variant, rateMap);
      if (vehicleCom === null) {
        missingVariants[String(variant || '(blank)')] = true;
      }

      // ASC invoices carry exactly one frame, which is why registration and
      // insurance can map straight onto it. The idx === 0 guard only matters
      // if that ever stops being true: registration and insurance are invoice
      // level figures, so they must not be counted once per frame.
      var thisReg = (isPermanent && idx === 0) ? Number(regCommission) : 0;
      var thisInsBase = (idx === 0 && insuranceAmount > 0) ? (insuranceAmount / INSURANCE_GST_DIVISOR) : 0;
      var thisInsCom = thisInsBase * (Number(insPct) / 100);

      var vc = vehicleCom === null ? 0 : vehicleCom;
      lines.push({
        invoiceNo: invoiceNo,
        invoiceDate: invoiceDate,
        frameNo: f['Frame No'] || '',
        modelVariant: variant || '',
        customerName: q['Customer Name'] || f['Customer Name'] || '',
        vehicleCom: vc,
        registrationType: q['Registration Type'] || '',
        registrationAmount: parseAmount_(q['Registration Amount']),
        regCom: thisReg,
        insuranceAmount: (idx === 0 ? insuranceAmount : 0),
        insRatePct: Number(insPct),
        insCom: thisInsCom,
        lineTotal: vc + thisReg + thisInsCom,
        rateMissing: vehicleCom === null
      });
    });
  });

  lines.sort(function (a, b) { return a.invoiceDate - b.invoiceDate; });

  return {
    lines: lines,
    missingVariants: Object.keys(missingVariants).sort(),
    multiFrameInvoices: multiFrameInvoices
  };
}

/** Rolls priced lines up into the invoice-level figures. Rounding happens here and nowhere else. */
function summariseCommissionLines_(lines, dealerCode) {
  var sgstPct = lookupCommissionConfig_(COMMISSION_CONFIG_KEYS.SGST_PCT, dealerCode, 9);
  var cgstPct = lookupCommissionConfig_(COMMISSION_CONFIG_KEYS.CGST_PCT, dealerCode, 9);

  var vehicleCom = 0, regCom = 0, insCom = 0;
  lines.forEach(function (l) {
    vehicleCom += l.vehicleCom;
    regCom += l.regCom;
    insCom += l.insCom;
  });
  var taxable = vehicleCom + regCom + insCom;
  var sgst = taxable * (Number(sgstPct) / 100);
  var cgst = taxable * (Number(cgstPct) / 100);

  return {
    frameCount: lines.length,
    vehicleCom: round2_(vehicleCom),
    regCom: round2_(regCom),
    insCom: round2_(insCom),
    taxable: round2_(taxable),
    sgst: round2_(sgst),
    cgst: round2_(cgst),
    invoiceAmount: Math.round(taxable + sgst + cgst)
  };
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ============================================================ CHECKPOINT =
/**
 * The 1st-of-month readiness check. For every active ASC it answers: how many
 * frames are waiting, which Model Variants still have no rate, and whether a
 * report already exists.
 *
 * A blocked ASC blocks only itself — every other ASC still generates on the
 * 2nd. Blocking the whole network because one variant is missing would punish
 * dealers who have nothing to do with it.
 */
function runCommissionCheckpoint(token, month) {
  return safeRun('runCommissionCheckpoint', function () {
    requireRole_(token, PERMISSIONS.Commission.generate);
    requireCommissionMonth_(month);
    return commissionCheckpoint_(month);
  });
}

function commissionCheckpoint_(month) {
  var rateMap = buildCommissionRateMap_();
  var ascDealers = getAllRows(SHEETS.DEALER_MASTER).filter(function (d) {
    return String(d.Type) === DEALER_TYPES.ASC && String(d.Status) !== 'Inactive';
  });
  var existingReports = getAllRows(SHEETS.COMMISSION_REPORT).filter(function (r) {
    return normalizeMonthKey_(r.Month) === month;
  });

  return ascDealers.map(function (d) {
    var dealerCode = d['Dealer Code'];
    var collected = collectCommissionLines_(dealerCode, month, rateMap);
    var summary = summariseCommissionLines_(collected.lines, dealerCode);
    var report = null;
    for (var i = 0; i < existingReports.length; i++) {
      if (String(existingReports[i]['Dealer Code']) === String(dealerCode)) { report = existingReports[i]; break; }
    }
    return {
      dealerCode: dealerCode,
      dealerName: d['Dealer Name'],
      frameCount: collected.lines.length,
      missingVariants: collected.missingVariants,
      multiFrameInvoices: collected.multiFrameInvoices,
      ready: collected.missingVariants.length === 0 && collected.lines.length > 0,
      previewInvoiceAmount: summary.invoiceAmount,
      reportId: report ? report['Report ID'] : '',
      reportStatus: report ? report.Status : '',
      canGenerate: !report || String(report.Status) === COMMISSION_STATUS.GENERATED
    };
  });
}

// ============================================================== GENERATE =
/**
 * Builds (or rebuilds) one ASC's report for one month.
 *
 * Rebuilding deletes the previous lines rather than layering new ones on top,
 * so the report is always a clean snapshot of the data as it stands right now.
 * It is refused outright once the ASC has been asked for an invoice.
 */
function generateCommissionReport(token, dealerCode, month) {
  return safeRun('generateCommissionReport', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.generate);
    requireCommissionMonth_(month);

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return generateCommissionReport_(dealerCode, month, session.username);
    } finally {
      lock.releaseLock();
    }
  });
}

function generateCommissionReport_(dealerCode, month, actor) {
  var dealer = findRow(SHEETS.DEALER_MASTER, 'Dealer Code', dealerCode);
  if (!dealer) throw new Error('Dealer not found: ' + dealerCode);
  if (String(dealer.Type) !== DEALER_TYPES.ASC) {
    throw new Error('Commission applies to ASC dealers only. ' + dealerCode + ' is type ' + dealer.Type + '.');
  }

  var existing = findCommissionReport_(dealerCode, month);
  if (existing && String(existing.Status) !== COMMISSION_STATUS.GENERATED) {
    throw new Error('This month is already at "' + existing.Status + '" for ' + dealerCode + ' and can no longer be regenerated.');
  }

  var collected = collectCommissionLines_(dealerCode, month, buildCommissionRateMap_());
  if (collected.missingVariants.length > 0) {
    throw new Error('Commission rate missing for: ' + collected.missingVariants.join(', ') +
      '. Add the rate(s) in Commission Rates first, then generate again.');
  }
  if (collected.lines.length === 0) {
    throw new Error('No submitted ASC vehicle sales found for ' + dealerCode + ' in ' + month + '.');
  }

  // Clean rebuild: drop the old snapshot entirely before writing the new one.
  if (existing) {
    var oldLines = findRows(SHEETS.COMMISSION_REPORT_LINE, { 'Report ID': existing['Report ID'] });
    if (oldLines.length) deleteRowsWhere_(SHEETS.COMMISSION_REPORT_LINE, oldLines);
    deleteRowsWhere_(SHEETS.COMMISSION_REPORT, [existing]);
  }

  var summary = summariseCommissionLines_(collected.lines, dealerCode);
  var reportId = generateId('CMR');

  appendRow(SHEETS.COMMISSION_REPORT, {
    'Report ID': reportId,
    'Dealer Code': dealerCode,
    'Month': monthCell_(month),
    'Status': COMMISSION_STATUS.GENERATED,
    'Frame Count': summary.frameCount,
    'Vehicle Com': summary.vehicleCom,
    'Reg Com': summary.regCom,
    'Ins Com': summary.insCom,
    'Taxable': summary.taxable,
    'SGST': summary.sgst,
    'CGST': summary.cgst,
    'Invoice Amount': summary.invoiceAmount,
    'Generated On': new Date(),
    'Generated By': actor,
    'Remarks': existing ? 'Regenerated' : ''
  }, actor);

  appendRows(SHEETS.COMMISSION_REPORT_LINE, collected.lines.map(function (l) {
    return {
      'Line ID': generateId('CML'),
      'Report ID': reportId,
      'Dealer Code': dealerCode,
      'Month': monthCell_(month),
      'Invoice No': l.invoiceNo,
      'Invoice Date': l.invoiceDate,
      'Frame No': l.frameNo,
      'Model Variant': l.modelVariant,
      'Customer Name': l.customerName,
      'Vehicle Com': l.vehicleCom,
      'Registration Type': l.registrationType,
      'Registration Amount': l.registrationAmount,
      'Reg Com': l.regCom,
      'Insurance Amount': l.insuranceAmount,
      'Ins Rate %': l.insRatePct,
      'Ins Com': round2_(l.insCom),
      'Line Total': round2_(l.lineTotal),
      'Created On': new Date()
    };
  }), actor);

  return { reportId: reportId, dealerCode: dealerCode, month: month, regenerated: !!existing, summary: summary };
}

/** Generates for every ASC that the checkpoint says is ready. Used by the "Generate all" button and the monthly trigger. */
function generateAllCommissionReports(token, month) {
  return safeRun('generateAllCommissionReports', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.generate);
    requireCommissionMonth_(month);
    return generateAllCommissionReports_(month, session.username);
  });
}

function generateAllCommissionReports_(month, actor) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var checkpoint = commissionCheckpoint_(month);
    var results = [];
    checkpoint.forEach(function (c) {
      if (!c.ready || !c.canGenerate) {
        results.push({
          dealerCode: c.dealerCode,
          dealerName: c.dealerName,
          done: false,
          reason: c.frameCount === 0 ? 'No sales this month'
            : (c.missingVariants.length ? 'Missing rate: ' + c.missingVariants.join(', ')
            : 'Already at ' + c.reportStatus)
        });
        return;
      }
      try {
        var r = generateCommissionReport_(c.dealerCode, month, actor);
        results.push({ dealerCode: c.dealerCode, dealerName: c.dealerName, done: true, invoiceAmount: r.summary.invoiceAmount });
      } catch (err) {
        results.push({ dealerCode: c.dealerCode, dealerName: c.dealerName, done: false, reason: err.message });
      }
    });
    return results;
  } finally {
    lock.releaseLock();
  }
}

// ================================================================ LISTING =
/**
 * Reports for a month (or all months if month is blank).
 *
 * A Dealer sees only its own, and only once an invoice has actually been
 * requested — showing an ASC a figure still under internal review would invite
 * arguments about numbers that are not final yet.
 */
function listCommissionReports(token, month) {
  return safeRun('listCommissionReports', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.view);
    var rows = getAllRows(SHEETS.COMMISSION_REPORT);
    if (month) rows = rows.filter(function (r) { return normalizeMonthKey_(r.Month) === month; });

    if (session.role === ROLES.DEALER) {
      rows = rows.filter(function (r) {
        return String(r['Dealer Code']) === String(session.dealerCode) &&
          String(r.Status) !== COMMISSION_STATUS.GENERATED;
      });
    }

    var names = getDealerNameMap_();
    return rows.map(function (r) {
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      out['Dealer Name'] = names[r['Dealer Code']] || '';
      out.Month = normalizeMonthKey_(r.Month);
      out.aging = commissionAging_(r);
      return out;
    }).sort(function (a, b) {
      if (a.Month !== b.Month) return a.Month < b.Month ? 1 : -1;
      return String(a['Dealer Name']) < String(b['Dealer Name']) ? -1 : 1;
    });
  });
}

/**
 * Three separate clocks, because they answer three different questions:
 *   pendingDays  how long the ASC has been sitting on an invoice request
 *   uploadDays   how long it took them, once they did upload
 *   verifyDays   how long Accounts then took to verify it
 */
function commissionAging_(r) {
  var requested = r['Invoice Requested On'] ? new Date(r['Invoice Requested On']) : null;
  var uploaded = r['Uploaded On'] ? new Date(r['Uploaded On']) : null;
  var verified = r['Verified On'] ? new Date(r['Verified On']) : null;
  return {
    pendingDays: (requested && !uploaded) ? daysBetween_(requested, new Date()) : null,
    uploadDays: (requested && uploaded) ? daysBetween_(requested, uploaded) : null,
    verifyDays: (uploaded && verified) ? daysBetween_(uploaded, verified) : null
  };
}

function daysBetween_(from, to) {
  return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)));
}

/** Header plus every frame line — the detail screen and the ASC's own view. */
function getCommissionReportDetail(token, reportId) {
  return safeRun('getCommissionReportDetail', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.view);
    var report = findRow(SHEETS.COMMISSION_REPORT, 'Report ID', reportId);
    if (!report) throw new Error('Report not found: ' + reportId);
    if (session.role === ROLES.DEALER) {
      if (String(report['Dealer Code']) !== String(session.dealerCode)) {
        throw new Error('You can only view your own commission reports.');
      }
      if (String(report.Status) === COMMISSION_STATUS.GENERATED) {
        throw new Error('This report is still under review and is not available yet.');
      }
    }
    var lines = findRows(SHEETS.COMMISSION_REPORT_LINE, { 'Report ID': reportId })
      .sort(function (a, b) { return parseInvoiceDate_(a['Invoice Date']) - parseInvoiceDate_(b['Invoice Date']); });
    var names = getDealerNameMap_();
    var header = {};
    Object.keys(report).forEach(function (k) { header[k] = report[k]; });
    header['Dealer Name'] = names[report['Dealer Code']] || '';
    header.Month = normalizeMonthKey_(report.Month);
    header.aging = commissionAging_(report);
    return { report: header, lines: lines };
  });
}

// ====================================================== INVOICE WORKFLOW =
/**
 * Hands the report to the ASC: from here the figures are frozen, the ASC can
 * see them, and an email goes out with the full breakup attached.
 *
 * The email is sent BEFORE the status is written. If MailApp fails (quota,
 * bad address) the whole call throws and the report stays in Generated, so
 * the request can simply be retried — rather than the ASC being marked as
 * asked when nothing ever reached them.
 */
function requestCommissionInvoice(token, reportId) {
  return safeRun('requestCommissionInvoice', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.request);
    var report = findRow(SHEETS.COMMISSION_REPORT, 'Report ID', reportId);
    if (!report) throw new Error('Report not found: ' + reportId);
    if (String(report.Status) !== COMMISSION_STATUS.GENERATED) {
      throw new Error('Invoice can only be requested for a report in "' + COMMISSION_STATUS.GENERATED + '" status. This one is "' + report.Status + '".');
    }

    var dealer = findRow(SHEETS.DEALER_MASTER, 'Dealer Code', report['Dealer Code']);
    if (!dealer) throw new Error('Dealer not found: ' + report['Dealer Code']);
    if (!isNonEmpty(dealer.Email)) {
      throw new Error('No email address on file for ' + dealer['Dealer Name'] +
        '. Add it in Dealer master, then request the invoice again.');
    }

    var lines = findRows(SHEETS.COMMISSION_REPORT_LINE, { 'Report ID': reportId })
      .sort(function (a, b) { return parseInvoiceDate_(a['Invoice Date']) - parseInvoiceDate_(b['Invoice Date']); });

    var month = normalizeMonthKey_(report.Month);
    var period = monthPeriod_(month);
    var pdfName = 'Commission-Breakup-' + slug_(dealer['Dealer Name']) + '-' +
      Utilities.formatDate(new Date(month + '-01T00:00:00Z'), 'Asia/Kolkata', 'MMM-yyyy');

    var recipients = [dealer.Email].concat(COMMISSION_EMAIL_CC);
    MailApp.sendEmail({
      to: dealer.Email,
      cc: COMMISSION_EMAIL_CC.join(','),
      // Reply-To carries all three internal desks so a plain "Reply" from the
      // ASC reaches them, instead of only the Google account that owns this
      // script.
      replyTo: COMMISSION_EMAIL_CC.join(','),
      name: COMMISSION_EMAIL_SENDER_NAME,
      subject: 'Commission for ' + period.label + ' — ' + formatCurrency(report['Invoice Amount']) +
        ' — please raise your tax invoice',
      htmlBody: buildRequestEmailHtml_(report, dealer),
      attachments: [htmlToPdfBlob_(buildBreakupHtml_(report, lines, dealer), pdfName)]
    });

    updateRowWhere(SHEETS.COMMISSION_REPORT, 'Report ID', reportId, {
      'Status': COMMISSION_STATUS.INVOICE_REQUESTED,
      'Invoice Requested On': new Date(),
      'Invoice Requested By': session.username,
      'Email Sent On': new Date(),
      'Email Recipients': recipients.join(', ')
    }, session.username);

    appendRow(SHEETS.NOTIFICATION_LOG, {
      'Dealer Code': report['Dealer Code'],
      'Type': 'Commission Invoice Requested',
      'Message': 'Commission for ' + month + ' is ready: ' + formatCurrency(report['Invoice Amount']) +
        '. Tax invoice raise karke Commission tab me upload karein.',
      'Timestamp': new Date(),
      'Read Status': false
    }, session.username);

    return { emailedTo: recipients };
  });
}

/**
 * The ASC saving (or changing) its invoice number and date before printing.
 *
 * Separate from upload on purpose: the ASC needs the number on the printed
 * sheet before there is anything to scan, and may reprint with a corrected
 * number any number of times. Allowed only while the report is still waiting
 * for an invoice — once uploaded, the number is what was physically signed
 * and must stop moving.
 */
function saveCommissionInvoiceDraft(token, reportId, invoiceNo, invoiceDate) {
  return safeRun('saveCommissionInvoiceDraft', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.upload);
    var report = findRow(SHEETS.COMMISSION_REPORT, 'Report ID', reportId);
    if (!report) throw new Error('Report not found: ' + reportId);
    if (session.role === ROLES.DEALER && String(report['Dealer Code']) !== String(session.dealerCode)) {
      throw new Error('You can only edit your own commission invoice.');
    }
    if (String(report.Status) !== COMMISSION_STATUS.INVOICE_REQUESTED) {
      throw new Error('This report is at "' + report.Status + '" — the invoice details can no longer be changed.');
    }
    if (!isNonEmpty(invoiceNo)) throw new Error('Invoice number is required.');
    if (!isNonEmpty(invoiceDate)) throw new Error('Invoice date is required.');

    updateRowWhere(SHEETS.COMMISSION_REPORT, 'Report ID', reportId, {
      'ASC Invoice No': sanitizeString(invoiceNo),
      'ASC Invoice Date': parseInvoiceDate_(invoiceDate)
    }, session.username);
    return true;
  });
}

/**
 * The printable tax invoice as a standalone HTML page, opened in a new tab by
 * the frontend. Printing happens in the browser rather than server-side so the
 * ASC can nudge the letterhead margins and reprint instantly.
 */
function getCommissionInvoiceHtml(token, reportId) {
  return safeRun('getCommissionInvoiceHtml', function () {
    var ctx = commissionDocContext_(token, reportId);
    return buildInvoiceHtml_(ctx.report, ctx.dealer, true);
  });
}

/**
 * A PDF of either document, base64-encoded for the browser to download.
 * kind: 'invoice' | 'breakup'.
 */
function getCommissionPdf(token, reportId, kind) {
  return safeRun('getCommissionPdf', function () {
    var ctx = commissionDocContext_(token, reportId);
    var month = normalizeMonthKey_(ctx.report.Month);
    var stamp = Utilities.formatDate(new Date(month + '-01T00:00:00Z'), 'Asia/Kolkata', 'MMM-yyyy');
    var html, name;

    if (kind === 'invoice') {
      html = buildInvoiceHtml_(ctx.report, ctx.dealer, false);
      name = 'Tax-Invoice-' + slug_(ctx.dealer['Dealer Name']) + '-' + stamp;
    } else {
      html = buildBreakupHtml_(ctx.report, ctx.lines, ctx.dealer);
      name = 'Commission-Breakup-' + slug_(ctx.dealer['Dealer Name']) + '-' + stamp;
    }

    var blob = htmlToPdfBlob_(html, name);
    return { filename: name + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
  });
}

/** Shared load + permission check for every document endpoint. A Dealer only ever reaches its own, and not while still under review. */
function commissionDocContext_(token, reportId) {
  var session = requireRole_(token, PERMISSIONS.Commission.view);
  var report = findRow(SHEETS.COMMISSION_REPORT, 'Report ID', reportId);
  if (!report) throw new Error('Report not found: ' + reportId);
  if (session.role === ROLES.DEALER) {
    if (String(report['Dealer Code']) !== String(session.dealerCode)) {
      throw new Error('You can only view your own commission documents.');
    }
    if (String(report.Status) === COMMISSION_STATUS.GENERATED) {
      throw new Error('This report is still under review and is not available yet.');
    }
  }
  var dealer = findRow(SHEETS.DEALER_MASTER, 'Dealer Code', report['Dealer Code']);
  if (!dealer) throw new Error('Dealer not found: ' + report['Dealer Code']);
  var lines = findRows(SHEETS.COMMISSION_REPORT_LINE, { 'Report ID': reportId })
    .sort(function (a, b) { return parseInvoiceDate_(a['Invoice Date']) - parseInvoiceDate_(b['Invoice Date']); });
  return { session: session, report: report, dealer: dealer, lines: lines };
}

/**
 * The ASC uploads its tax invoice.
 *
 * The amount must match to the rupee. Confirmed as the intended rule: a
 * mismatch means the invoice itself is wrong and has to be reissued, so
 * accepting it here would just push a reconciliation problem into Tally.
 */
function uploadCommissionInvoice(token, reportId, invoiceNo, invoiceDate, amount, attachmentLink) {
  return safeRun('uploadCommissionInvoice', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.upload);

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var report = findRow(SHEETS.COMMISSION_REPORT, 'Report ID', reportId);
      if (!report) throw new Error('Report not found: ' + reportId);
      if (session.role === ROLES.DEALER && String(report['Dealer Code']) !== String(session.dealerCode)) {
        throw new Error('You can only upload an invoice for your own commission report.');
      }
      if (String(report.Status) !== COMMISSION_STATUS.INVOICE_REQUESTED) {
        throw new Error('This report is at "' + report.Status + '" — an invoice cannot be uploaded now.');
      }
      if (!isNonEmpty(invoiceNo)) throw new Error('Invoice number is required.');
      if (!isNonEmpty(invoiceDate)) throw new Error('Invoice date is required.');
      if (!isNonEmpty(attachmentLink)) throw new Error('A copy of the tax invoice is required.');

      var expected = Number(report['Invoice Amount']);
      var given = Math.round(Number(amount) || 0);
      if (given !== expected) {
        throw new Error('Invoice amount ' + formatCurrency(given) + ' does not match the calculated amount ' +
          formatCurrency(expected) + '. Please correct the invoice and upload again.');
      }

      updateRowWhere(SHEETS.COMMISSION_REPORT, 'Report ID', reportId, {
        'Status': COMMISSION_STATUS.INVOICE_UPLOADED,
        'ASC Invoice No': sanitizeString(invoiceNo),
        'ASC Invoice Date': parseInvoiceDate_(invoiceDate),
        'ASC Invoice Amount': given,
        'Attachment Link': attachmentLink,
        'Uploaded On': new Date(),
        'Uploaded By': session.username
      }, session.username);
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Accounts/Admin confirm the invoice went into Tally, and the amount lands in
 * the ASC's ledger as a Credit dated with the TALLY entry date — not today —
 * so the portal ledger and Tally agree on when it happened.
 *
 * This is the point of no return: the month is locked afterwards.
 */
function verifyCommissionInvoice(token, reportId, tallyEntryDate, remarks) {
  return safeRun('verifyCommissionInvoice', function () {
    var session = requireRole_(token, PERMISSIONS.Commission.verify);

    // Same reasoning as approvePayment: two fast clicks must not both see
    // "Invoice Uploaded" and both post a ledger credit.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var report = findRow(SHEETS.COMMISSION_REPORT, 'Report ID', reportId);
      if (!report) throw new Error('Report not found: ' + reportId);
      if (String(report.Status) !== COMMISSION_STATUS.INVOICE_UPLOADED) {
        throw new Error('Only an uploaded invoice can be verified. This report is at "' + report.Status + '".');
      }
      if (!isNonEmpty(tallyEntryDate)) throw new Error('Tally entry date is required.');

      var entryDate = parseInvoiceDate_(tallyEntryDate);
      var entryId = generateId('LED');
      var amount = Number(report['Invoice Amount']);

      appendRow(SHEETS.LEDGER_TRANSACTIONS, {
        'Entry ID': entryId,
        'Date': entryDate,
        'Invoice No': report['ASC Invoice No'] || '',
        'Head': COMMISSION_LEDGER_HEAD,
        'Dealer Code': report['Dealer Code'],
        'Debit': 0,
        'Credit': amount,
        'Running Balance': 0,
        'Remarks': 'Network commission ' + report.Month + ' (invoice ' + (report['ASC Invoice No'] || '-') + ')',
        'Created By': session.username,
        'Timestamp': new Date(),
        'Invoice Date': report['ASC Invoice Date'] || entryDate
      }, session.username);
      recomputeRunningBalance_(report['Dealer Code']);

      updateRowWhere(SHEETS.COMMISSION_REPORT, 'Report ID', reportId, {
        'Status': COMMISSION_STATUS.POSTED,
        'Tally Entry Date': entryDate,
        'Verified By': session.username,
        'Verified On': new Date(),
        'Ledger Entry ID': entryId,
        'Remarks': remarks || report.Remarks || ''
      }, session.username);

      return { ledgerEntryId: entryId, amount: amount };
    } finally {
      lock.releaseLock();
    }
  });
}

// ================================================================ HELPERS =
/**
 * Whatever came back from the sheet, turned into a clean 'YYYY-MM'.
 *
 * Sheets silently coerces the string '2026-08' into a DATE when it is
 * written, and getAllRows then hands it back as the ISO string
 * '2026-07-31T18:30:00.000Z' (IST midnight on 1 Aug is 18:30 UTC on 31 Jul).
 * That broke three things at once: the month column displayed an ISO stamp,
 * the month filter never matched, and — worst — findCommissionReport_ and the
 * checkpoint could not find an existing report, so Regenerate would have
 * appended a SECOND report row instead of replacing the first.
 *
 * Writes now go through monthCell_() so Sheets stores text, and every read
 * goes through here so rows written before this fix still resolve correctly.
 */
function normalizeMonthKey_(value) {
  if (!value) return '';
  var s = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  var d = new Date(value);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM');
  return s;
}

/** Leading apostrophe tells Sheets "this is text, do not parse it as a date". It is not part of the stored value. */
function monthCell_(month) {
  return "'" + month;
}

function requireCommissionMonth_(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    throw new Error('Month must be in YYYY-MM format, e.g. 2026-07.');
  }
}

function findCommissionReport_(dealerCode, month) {
  var rows = getAllRows(SHEETS.COMMISSION_REPORT);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Dealer Code']) === String(dealerCode) &&
        normalizeMonthKey_(rows[i].Month) === month) return rows[i];
  }
  return null;
}

/** YYYY-MM of the month before the given date (defaults to today). */
function previousMonthKey_(from) {
  var d = from ? new Date(from) : new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM');
}

/**
 * One-time repair for reports written before the Month fix.
 *
 * Rewrites every Month cell in Commission_Report and Commission_Report_Line
 * as plain text 'YYYY-MM'. Safe to run more than once — a cell already in the
 * right form is skipped, so nothing is touched twice and nothing is lost.
 *
 * Run once from the Apps Script editor after deploying.
 */
function fixCommissionMonthValues() {
  var fixed = { reports: 0, lines: 0 };

  [[SHEETS.COMMISSION_REPORT, 'reports'], [SHEETS.COMMISSION_REPORT_LINE, 'lines']].forEach(function (pair) {
    var tab = pair[0];
    var sheet = getSpreadsheet().getSheetByName(tab);
    if (!sheet || sheet.getLastRow() < 2) return;

    var col = SHEET_HEADERS[tab].indexOf('Month') + 1;
    var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    var values = range.getValues();
    var changed = false;

    var out = values.map(function (row) {
      var raw = row[0];
      if (!raw) return row;
      var key = normalizeMonthKey_(
        (raw && typeof raw === 'object' && typeof raw.toISOString === 'function') ? raw.toISOString() : raw
      );
      if (String(raw) === key) return row;   // already plain text
      changed = true;
      fixed[pair[1]]++;
      return [monthCell_(key)];
    });

    if (changed) {
      range.setValues(out);
      invalidateSheetCache_(tab);
    }
  });

  Logger.log('Month values repaired — ' + fixed.reports + ' report row(s), ' + fixed.lines + ' line row(s).');
  return fixed;
}

// =============================================================== TRIGGERS =
/**
 * Run ONCE from the Apps Script editor. Sets the monthly rhythm:
 *   1st, 09:00 — checkpoint. Anything missing is raised to Admin and the
 *                Network Manager while there is still a day to fix it.
 *   2nd, 09:00 — generate every ASC that came out of the checkpoint clean.
 * Safe to re-run: it clears its own previous triggers first.
 */
function setupCommissionTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'scheduledCommissionCheckpoint_' || fn === 'scheduledCommissionGenerate_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('scheduledCommissionCheckpoint_').timeBased().onMonthDay(1).atHour(9).create();
  ScriptApp.newTrigger('scheduledCommissionGenerate_').timeBased().onMonthDay(2).atHour(9).create();
  Logger.log('Commission triggers set: checkpoint on the 1st at 09:00, generation on the 2nd at 09:00.');
}

/**
 * Notifies about last month's blockers. Notifications are written against the
 * blocked ASC's own Dealer Code so the dealer-wise view stays coherent — but
 * only Admin, Accounts and Network Manager can read Notification_Log for
 * dealers other than their own, so this does not leak to the ASC.
 */
function scheduledCommissionCheckpoint_() {
  var month = previousMonthKey_();
  var checkpoint = commissionCheckpoint_(month);
  var blocked = checkpoint.filter(function (c) { return c.missingVariants.length > 0; });
  if (blocked.length === 0) {
    Logger.log('Commission checkpoint ' + month + ': all ASCs clear.');
    return;
  }
  blocked.forEach(function (c) {
    appendRow(SHEETS.NOTIFICATION_LOG, {
      'Dealer Code': c.dealerCode,
      'Type': 'Commission Rate Missing',
      'Message': c.dealerName + ' (' + c.dealerCode + ') cannot be generated for ' + month +
        ' — no commission rate on file for: ' + c.missingVariants.join(', ') +
        '. Add the rate(s) in Commission Rates, then use Generate now.',
      'Timestamp': new Date(),
      'Read Status': false
    }, 'System');
  });
  logAction('System', 'COMMISSION CHECKPOINT ' + month, '',
    blocked.length + ' ASC(s) blocked: ' + blocked.map(function (c) { return c.dealerCode; }).join(', '));
}

function scheduledCommissionGenerate_() {
  var month = previousMonthKey_();
  var results = generateAllCommissionReports_(month, 'System (Scheduled)');
  Logger.log('Commission generation ' + month + ': ' + JSON.stringify(results));
}

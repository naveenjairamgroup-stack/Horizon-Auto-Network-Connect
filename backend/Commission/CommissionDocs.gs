/**
 * CommissionDocs.gs
 * Everything the commission module prints, emails or hands back as a PDF.
 *
 * ---------------------------------------------------------------------
 * ONE LAYOUT, THREE DESTINATIONS
 * ---------------------------------------------------------------------
 * The tax invoice is built as HTML exactly once, by buildInvoiceHtml_. That
 * same string is used for the ASC's print window and for the downloadable
 * PDF. Two separate layouts would drift apart the first time a column moved,
 * and a commission invoice that doesn't match the PDF the ASC actually files
 * is worse than no invoice at all.
 *
 * The frame-wise breakup works the same way: one builder, used as the email
 * attachment and as the "Breakup PDF" download.
 *
 * PDFs come from Utilities.newBlob(html).getAs(PDF) — Apps Script's built-in
 * converter. It handles tables and inline CSS well, which is all these
 * documents use. No external service, no extra dependency.
 * ---------------------------------------------------------------------
 */

// ============================================================== HELPERS =
/** HTML-escapes a value before it goes into a document. Customer names come from import files and are never sanitised on the way in. */
function esc_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 22018 -> "22,018.00" using the Indian grouping (last three, then pairs). */
function inr_(n) {
  var num = Number(n) || 0;
  var neg = num < 0;
  num = Math.abs(num);
  var parts = num.toFixed(2).split('.');
  var whole = parts[0];
  var last3 = whole.length > 3 ? whole.slice(-3) : whole;
  var rest = whole.length > 3 ? whole.slice(0, -3) : '';
  if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  return (neg ? '-' : '') + last3 + '.' + parts[1];
}

/**
 * 22018 -> "Twenty Two Thousand Eighteen Only." — Indian numbering, because
 * the invoice needs the value in words and lakh/crore is what a GST invoice
 * from Jharkhand is expected to read.
 */
function amountInWords_(amount) {
  var n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Only.';

  var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function under100(x) {
    if (x < 20) return ones[x];
    var t = tens[Math.floor(x / 10)];
    return x % 10 ? t + ' ' + ones[x % 10] : t;
  }
  function under1000(x) {
    if (x < 100) return under100(x);
    var h = ones[Math.floor(x / 100)] + ' Hundred';
    return x % 100 ? h + ' ' + under100(x % 100) : h;
  }

  var out = [];
  var crore = Math.floor(n / 10000000); n %= 10000000;
  var lakh = Math.floor(n / 100000);   n %= 100000;
  var thousand = Math.floor(n / 1000); n %= 1000;

  if (crore) out.push(under1000(crore) + ' Crore');
  if (lakh) out.push(under1000(lakh) + ' Lakh');
  if (thousand) out.push(under1000(thousand) + ' Thousand');
  if (n) out.push(under1000(n));

  return out.join(' ') + ' Only.';
}

/** 'YYYY-MM' -> { from: '01/08/2026', to: '31/08/2026', label: 'August 2026' } */
function monthPeriod_(monthKey) {
  var parts = String(monthKey).split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var first = new Date(y, m - 1, 1);
  var last = new Date(y, m, 0); // day 0 of next month = last day of this one
  return {
    from: Utilities.formatDate(first, 'Asia/Kolkata', 'dd/MM/yyyy'),
    to: Utilities.formatDate(last, 'Asia/Kolkata', 'dd/MM/yyyy'),
    label: Utilities.formatDate(first, 'Asia/Kolkata', 'MMMM yyyy')
  };
}

function fmtDate_(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy');
}

/**
 * Splits a free-text address into two display lines without cutting a word in
 * half. Dealer_Master keeps the address in one cell, but the invoice block
 * has two lines for it.
 */
function splitAddress_(address) {
  var a = String(address || '').trim();
  if (a.length <= 46) return [a, ''];
  var cut = a.lastIndexOf(',', 52);
  if (cut < 20) cut = a.lastIndexOf(' ', 52);
  if (cut < 20) cut = 46;
  return [a.slice(0, cut + 1).trim(), a.slice(cut + 1).trim()];
}

// ========================================================== TAX INVOICE =
/**
 * The full tax invoice as a standalone HTML page.
 *
 * forPrint = true adds the on-screen toolbar (margin sliders + Print button)
 * and the dashed letterhead guides. For the PDF version both are dropped, so
 * the file contains only the invoice box itself.
 *
 * The header and footer of the ASC's own letterhead are deliberately NOT
 * drawn: they print this on their pre-printed stationery, so that space is
 * left blank rather than duplicated.
 */
function buildInvoiceHtml_(report, dealer, forPrint, padTop, padBottom) {
  // The letterhead reserve applies to BOTH the print window and the PDF — a
  // saved PDF is printed on the same letterhead paper, so it needs the same
  // blank space. forPrint only decides whether the toolbar and the dashed
  // on-screen guides are drawn.
  padTop = padTop || COMMISSION_LETTERHEAD_TOP_MM + 'mm';
  padBottom = padBottom || COMMISSION_LETTERHEAD_BOTTOM_MM + 'mm';
  var period = monthPeriod_(normalizeMonthKey_(report.Month));
  var addr = splitAddress_(dealer.Address);
  var taxable = Number(report.Taxable) || 0;
  var sgst = Number(report.SGST) || 0;
  var cgst = Number(report.CGST) || 0;
  var total = Number(report['Invoice Amount']) || 0;
  var sgstPct = taxable ? Math.round((sgst / taxable) * 100) : 9;
  var cgstPct = taxable ? Math.round((cgst / taxable) * 100) : 9;

  var invNo = report['ASC Invoice No'] || '';
  var invDate = fmtDate_(report['ASC Invoice Date']);

  var toolbar = '';
  if (forPrint) {
    toolbar =
      '<div class="toolbar">' +
        '<h1>Tax invoice — commission for ' + esc_(period.label) + '</h1>' +
        '<div class="field"><label for="pt">Top space (mm)</label>' +
          '<input id="pt" type="number" value="' + COMMISSION_LETTERHEAD_TOP_MM + '" min="0" max="120"></div>' +
        '<div class="field"><label for="pb">Bottom space (mm)</label>' +
          '<input id="pb" type="number" value="' + COMMISSION_LETTERHEAD_BOTTOM_MM + '" min="0" max="120"></div>' +
        '<button onclick="window.print()">Print</button>' +
        '<p class="hint">The dashed areas are the space left for your pre-printed letterhead — they do not ' +
        'appear on paper. Adjust the two figures until the box sits where you want it, then print. ' +
        'To keep a copy instead, choose <strong>Save as PDF</strong> in the print dialog.</p>' +
      '</div>';
  }

  var guideTop = forPrint ? '<div class="reserve">space reserved for your letterhead</div>' : '';
  var guideBottom = forPrint ? '<div class="reserve reserve-bottom">space reserved for your letterhead footer</div>' : '';

  return '' +
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width, initial-scale=1">' +
'<title>Tax Invoice — ' + esc_(dealer['Dealer Name']) + ' — ' + esc_(period.label) + '</title><style>' +
':root{--pad-top:' + padTop + ';--pad-bottom:' + padBottom + ';}' +
'*{box-sizing:border-box}' +
'body{margin:0;background:' + (forPrint ? '#e8e8e8' : '#fff') + ';font-family:"Times New Roman",Times,serif;color:#000;font-size:13px}' +
'.toolbar{background:#1b1b1b;color:#fff;padding:14px 20px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;position:sticky;top:0;z-index:10}' +
'.toolbar h1{font-size:14px;margin:0;font-weight:600;flex:1 1 100%}' +
'.field{display:flex;flex-direction:column;gap:4px}' +
'.field label{font-size:11px;color:#b4b4b4}' +
'.field input{font:inherit;padding:6px 9px;border:1px solid #4a4a4a;background:#2a2a2a;color:#fff;border-radius:3px;width:88px}' +
'.toolbar button{font:inherit;font-weight:600;padding:8px 20px;border:0;border-radius:3px;background:#c8102e;color:#fff;cursor:pointer}' +
'.toolbar .hint{flex:1 1 100%;color:#9a9a9a;font-size:12px;line-height:1.5;border-top:1px solid #333;padding-top:10px;margin:2px 0 0}' +
'.sheet{width:210mm;min-height:297mm;margin:24px auto;background:#fff;padding:var(--pad-top) 16mm var(--pad-bottom) 16mm;box-shadow:0 2px 14px rgba(0,0,0,.22)}' +
(forPrint ? '' : '.sheet{width:auto;min-height:0;margin:0;box-shadow:none;padding:var(--pad-top) 16mm var(--pad-bottom) 16mm}') +
'.reserve{border:1px dashed #c9c9c9;color:#b0b0b0;font-family:system-ui,sans-serif;font-size:11px;text-align:center;padding:6px;margin-bottom:10mm}' +
'.reserve-bottom{margin:10mm 0 0}' +
'table{border-collapse:collapse;width:100%}' +
'.box,.box td,.box th{border:1px solid #000}' +
'.box td,.box th{padding:4px 6px;vertical-align:top;font-weight:normal}' +
'.title-cell{text-align:center;font-size:16px;padding:8px 6px;font-weight:bold}' +
'.right-note{text-align:right;font-size:11px;width:32%}' +
'.party{line-height:1.65}.party .lbl{display:inline-block;min-width:78px}.party .name{font-weight:bold}' +
'.svc th{text-align:center;font-size:11px;line-height:1.3}' +
'.svc td{font-size:12px;vertical-align:middle}' +
'.num{text-align:right}.ctr{text-align:center}' +
'.total-row td{font-weight:bold}.words{line-height:1.8}' +
'.sign-cell{height:92px;line-height:1.9}.sign-line{border-top:1px solid #000;padding-top:3px}' +
'.fill{font-weight:bold}' +
'@media print{body{background:#fff}.toolbar,.reserve{display:none!important}' +
'.sheet{width:auto;min-height:0;margin:0;box-shadow:none;padding:var(--pad-top) 0 var(--pad-bottom) 0}' +
'@page{size:A4;margin:0 16mm}}' +
'</style></head><body>' +
toolbar +
'<div class="sheet" id="sheet">' + guideTop +

'<table class="box">' +
'<tr><td colspan="2" class="title-cell">Tax Invoice</td>' +
'<td class="right-note">Original For Recipient</td></tr>' +
'<tr>' +
'<td style="width:34%">Dealer Code: &nbsp;<strong>' + esc_(report['Dealer Code']) + '</strong></td>' +
'<td style="width:34%">Invoice No: &nbsp;<span class="fill">' + esc_(invNo) + '</span></td>' +
'<td>Invoice Date: &nbsp;<span class="fill">' + esc_(invDate) + '</span></td></tr>' +
'<tr><td colspan="2" class="party">' +
'<span class="lbl">Dealer Name:</span> <span class="name">' + esc_(dealer['Dealer Name']) + '</span><br><br>' +
'<span class="lbl">Address:</span> ' + esc_(addr[0]) + '<br>' +
(addr[1] ? '<span class="lbl">&nbsp;</span> ' + esc_(addr[1]) + '<br>' : '') +
'Pin code: ' + esc_(dealer['Pin Code'] || '') + '<br><br>' +
'Email: ' + esc_(dealer.Email || '') + '<br>Fax No.<br><br>' +
'<span class="lbl">GSTIN:</span> ' + esc_(dealer.GST || '') + '<br>' +
'<span class="lbl">PAN:</span> ' + esc_(dealer.PAN || '') + '<br>' +
'<span class="lbl">CIN:</span><br>' +
'State: ' + COMMISSION_DEFAULT_STATE + ' &nbsp; State Code: ' + COMMISSION_DEFAULT_STATE_CODE +
'</td>' +
'<td class="party">Billed To: Place of Supply:<br>' +
'<span class="lbl">Name:</span> <span class="name">' + esc_(COMPANY.name) + '</span><br><br>' +
'<span class="lbl">Address:</span> ' + esc_(COMPANY.addressLine1) + '<br>' +
'<span class="lbl">&nbsp;</span> ' + esc_(COMPANY.addressLine2) + '<br>' +
'Pin Code: ' + esc_(COMPANY.pinCode) + '<br><br>' +
'<span class="lbl">GSTIN:</span> ' + esc_(COMPANY.gstin) + '<br>' +
'<span class="lbl">Tele:</span> ' + esc_(COMPANY.tele) + '<br><br>' +
'<span class="lbl">PAN:</span> ' + esc_(COMPANY.pan) + '<br>' +
'<span class="lbl">CIN:</span><br>' +
'State: ' + COMPANY.state + ' State Code:' + COMPANY.stateCode +
'</td></tr></table>' +

'<table class="box svc" style="margin-top:-1px">' +
'<tr>' +
'<th rowspan="2" style="width:20%">Description of Service</th>' +
'<th rowspan="2" style="width:8%">SAC</th>' +
'<th rowspan="2" style="width:11%">Taxable<br>Amount</th>' +
'<th colspan="2" style="width:16%">SGST/UTGST</th>' +
'<th colspan="2" style="width:16%">CGST</th>' +
'<th colspan="2" style="width:16%">IGST</th>' +
'<th rowspan="2">Total Amount</th></tr>' +
'<tr><th>Rate %</th><th>Amount</th><th>Rate%</th><th>Amount</th><th>Rate%</th><th>Amount</th></tr>' +
'<tr>' +
'<td>VEHICLE COMMISSION FOR THE PERIOD ' + period.from + ' TO ' + period.to + '</td>' +
'<td class="ctr">' + COMMISSION_SAC + '</td>' +
'<td class="num">' + inr_(taxable) + '</td>' +
'<td class="ctr">' + sgstPct + '%</td><td class="num">' + inr_(sgst) + '</td>' +
'<td class="ctr">' + cgstPct + '%</td><td class="num">' + inr_(cgst) + '</td>' +
'<td class="ctr"></td><td class="num">0.00</td>' +
'<td class="num">' + inr_(total) + '</td></tr>' +
'<tr class="total-row"><td colspan="9" class="num">Total Invoice Amount</td>' +
'<td class="num">' + inr_(total) + '</td></tr></table>' +

'<table class="box" style="margin-top:-1px"><tr>' +
'<td class="words" style="width:58%">' +
'Total Invoice Value (in figures): ' + inr_(total) + '<br>' +
'Total Invoice Value (in words): ' + amountInWords_(total) + '<br>' +
'If reverse charge applicable, then specify amount of tax:</td>' +
'<td class="sign-cell">For <strong>' + esc_(dealer['Dealer Name']) + '</strong><br><br><br><br>' +
'<span class="sign-line">Signature</span><br>Name of Signatory<br>Designation</td>' +
'</tr></table>' +

guideBottom + '</div>' +
(forPrint ?
  '<script>function pad(){var s=document.getElementById("sheet");' +
  's.style.setProperty("--pad-top",document.getElementById("pt").value+"mm");' +
  's.style.setProperty("--pad-bottom",document.getElementById("pb").value+"mm");}' +
  'document.getElementById("pt").addEventListener("input",pad);' +
  'document.getElementById("pb").addEventListener("input",pad);<\/script>' : '') +
'</body></html>';
}

// ========================================================= BREAKUP SHEET =
/** The frame-wise annexure: one row per vehicle, mirroring the working sheet this replaced. */
function buildBreakupHtml_(report, lines, dealer) {
  var period = monthPeriod_(normalizeMonthKey_(report.Month));
  var rows = '';
  lines.forEach(function (l, i) {
    rows +=
      '<tr>' +
      '<td class="ctr">' + (i + 1) + '</td>' +
      '<td>' + esc_(l['Invoice No']) + '</td>' +
      '<td class="ctr">' + fmtDate_(l['Invoice Date']) + '</td>' +
      '<td>' + esc_(l['Frame No']) + '</td>' +
      '<td>' + esc_(l['Model Variant']) + '</td>' +
      '<td>' + esc_(l['Customer Name']) + '</td>' +
      '<td class="num">' + inr_(l['Vehicle Com']) + '</td>' +
      '<td>' + esc_(l['Registration Type']) + '</td>' +
      '<td class="num">' + inr_(l['Reg Com']) + '</td>' +
      '<td class="num">' + inr_(l['Insurance Amount']) + '</td>' +
      '<td class="ctr">' + esc_(l['Ins Rate %']) + '%</td>' +
      '<td class="num">' + inr_(l['Ins Com']) + '</td>' +
      '<td class="num"><strong>' + inr_(l['Line Total']) + '</strong></td>' +
      '</tr>';
  });

  return '' +
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
'<title>Commission breakup — ' + esc_(dealer['Dealer Name']) + ' — ' + esc_(period.label) + '</title><style>' +
'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1a1a1a;margin:14px}' +
'h1{font-size:15px;margin:0 0 2px}' +
'.sub{color:#666;font-size:10.5px;margin-bottom:14px}' +
'table{border-collapse:collapse;width:100%}' +
'th,td{border:1px solid #b9b9b9;padding:4px 5px;vertical-align:middle}' +
'th{background:#f2f2f2;font-size:9.5px;text-align:center}' +
'.num{text-align:right;white-space:nowrap}.ctr{text-align:center;white-space:nowrap}' +
'tfoot td{background:#f7f7f7;font-weight:bold}' +
'.totals{margin-top:16px;width:auto;min-width:290px}' +
'.totals td{border:0;border-bottom:1px solid #ececec;padding:5px 8px}' +
'.totals td:last-child{text-align:right;white-space:nowrap}' +
'.totals tr.grand td{border-top:2px solid #1a1a1a;border-bottom:0;font-weight:bold;font-size:12px}' +
'.foot{margin-top:16px;color:#777;font-size:9px}' +
'</style></head><body>' +
'<h1>Commission breakup — ' + esc_(dealer['Dealer Name']) + ' (' + esc_(report['Dealer Code']) + ')</h1>' +
'<div class="sub">' + esc_(period.label) + ' &nbsp;·&nbsp; ' + period.from + ' to ' + period.to +
' &nbsp;·&nbsp; ' + lines.length + ' vehicles</div>' +
'<table><thead><tr>' +
'<th>#</th><th>Invoice no.</th><th>Date</th><th>Frame no.</th><th>Model variant</th><th>Customer</th>' +
'<th>Vehicle com</th><th>Registration</th><th>Reg com</th><th>Insurance</th><th>Ins %</th><th>Ins com</th><th>Line total</th>' +
'</tr></thead><tbody>' + rows + '</tbody>' +
'<tfoot><tr>' +
'<td colspan="6" class="num">Total</td>' +
'<td class="num">' + inr_(report['Vehicle Com']) + '</td><td></td>' +
'<td class="num">' + inr_(report['Reg Com']) + '</td><td></td><td></td>' +
'<td class="num">' + inr_(report['Ins Com']) + '</td>' +
'<td class="num">' + inr_(report.Taxable) + '</td>' +
'</tr></tfoot></table>' +
'<table class="totals"><tbody>' +
'<tr><td>Taxable value</td><td>' + inr_(report.Taxable) + '</td></tr>' +
'<tr><td>SGST 9%</td><td>' + inr_(report.SGST) + '</td></tr>' +
'<tr><td>CGST 9%</td><td>' + inr_(report.CGST) + '</td></tr>' +
'<tr class="grand"><td>Invoice amount (rounded)</td><td>&#8377; ' + inr_(report['Invoice Amount']) + '</td></tr>' +
'</tbody></table>' +
'<div class="foot">Generated by Horizon Auto Network Connect on ' +
Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm') + '.</div>' +
'</body></html>';
}

// ================================================================ EMAIL =
/** The body of the invoice-request email. Summary inline, frame detail in the attached PDF. */
function buildRequestEmailHtml_(report, dealer) {
  var period = monthPeriod_(normalizeMonthKey_(report.Month));
  var brand = '#c8102e';

  function figRow(label, value, dim) {
    return '<tr><td style="padding:7px 0;border-bottom:1px solid #f0f0f0;' +
      (dim ? 'color:#6b6b6b;' : '') + '">' + label + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #f0f0f0;text-align:right;">' + value + '</td></tr>';
  }

  return '' +
'<div style="font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;color:#1a1a1a;line-height:1.55;max-width:640px;">' +
'<div style="background:' + brand + ';color:#fff;padding:20px 28px;">' +
'<div style="font-size:17px;font-weight:650;">Horizon Auto</div>' +
'<div style="font-size:11.5px;opacity:.82;letter-spacing:.16em;margin-top:2px;">NETWORK CONNECT</div></div>' +
'<div style="padding:26px 28px 30px;border:1px solid #e2e2e2;border-top:0;">' +

'<p style="margin:0 0 15px;font-size:14.5px;">Dear ' + esc_(dealer['Dealer Name']) +
' (' + esc_(report['Dealer Code']) + '),</p>' +
'<p style="margin:0 0 15px;font-size:14.5px;">Your network commission for ' + esc_(period.label) +
' has been calculated and verified. Please raise your tax invoice for the amount below.</p>' +

'<div style="background:#faf9f9;border:1px solid #e2e2e2;border-left:3px solid ' + brand +
';padding:15px 18px;margin:18px 0;">' +
'<div style="font-size:12.5px;color:#6b6b6b;">Invoice this amount</div>' +
'<div style="font-size:27px;font-weight:680;margin-top:1px;">&#8377;' + inr_(report['Invoice Amount']) + '</div>' +
'<div style="font-size:12.5px;color:#6b6b6b;margin-top:3px;">' + report['Frame Count'] +
' vehicles &nbsp;·&nbsp; ' + period.from + ' to ' + period.to + '</div></div>' +

'<h2 style="font-size:13px;font-weight:650;margin:26px 0 10px;padding-bottom:7px;border-bottom:1px solid #e2e2e2;">' +
'How the amount is made up</h2>' +
'<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
figRow('Vehicle commission', inr_(report['Vehicle Com'])) +
figRow('Registration commission', inr_(report['Reg Com'])) +
figRow('Insurance commission', inr_(report['Ins Com'])) +
'<tr><td style="padding:7px 0;border-top:1px solid #e2e2e2;font-weight:650;">Taxable value</td>' +
'<td style="padding:7px 0;border-top:1px solid #e2e2e2;text-align:right;font-weight:650;">' +
inr_(report.Taxable) + '</td></tr>' +
figRow('SGST 9%', inr_(report.SGST), true) +
figRow('CGST 9%', inr_(report.CGST), true) +
'<tr><td style="padding:9px 0 0;border-top:2px solid #1a1a1a;font-weight:700;font-size:15.5px;">Total invoice value</td>' +
'<td style="padding:9px 0 0;border-top:2px solid #1a1a1a;text-align:right;font-weight:700;font-size:15.5px;">&#8377;' +
inr_(report['Invoice Amount']) + '</td></tr></table>' +

'<p style="margin:16px 0 0;font-size:13.5px;color:#6b6b6b;">The attached PDF lists all ' +
report['Frame Count'] + ' vehicles with frame number, model, customer name and the commission ' +
'worked out on each one.</p>' +

'<h2 style="font-size:13px;font-weight:650;margin:26px 0 10px;padding-bottom:7px;border-bottom:1px solid #e2e2e2;">' +
'What to do next</h2>' +
'<ol style="margin:0 0 4px;padding-left:20px;font-size:14.5px;">' +
'<li style="margin-bottom:8px;">Open the Commission tab in the portal — your invoice is already filled in.</li>' +
'<li style="margin-bottom:8px;">Enter your invoice number and date, then print it on your letterhead.</li>' +
'<li style="margin-bottom:8px;">Sign, stamp, and upload the scanned copy in the same screen.</li>' +
'</ol>' +
'<p style="margin:10px 0 4px;"><a href="' + COMMISSION_PORTAL_URL +
'" style="display:inline-block;background:' + brand + ';color:#fff;text-decoration:none;font-weight:600;' +
'font-size:14px;padding:11px 24px;border-radius:4px;">Open the portal</a></p>' +

'<div style="background:#fff8e6;border:1px solid #f0dfae;padding:12px 15px;font-size:13.5px;margin:18px 0 0;">' +
'The invoice must be for exactly <strong>&#8377;' + inr_(report['Invoice Amount']) +
'</strong>. Any other amount will be rejected at upload and the invoice will have to be reissued.</div>' +

'<div style="border-top:1px solid #e2e2e2;margin-top:26px;padding-top:16px;font-size:12px;color:#6b6b6b;line-height:1.6;">' +
'If any figure looks wrong, reply to this email or contact your Network Manager before raising the invoice.<br><br>' +
esc_(COMPANY.name) + ' · ' + esc_(COMPANY.addressLine1) + ' ' + esc_(COMPANY.addressLine2) + ' ' +
esc_(COMPANY.pinCode) + '<br>GSTIN ' + esc_(COMPANY.gstin) +
' · This is an automated message from Network Connect.</div>' +
'</div></div>';
}

// ================================================================= PDFs =
function htmlToPdfBlob_(html, filename) {
  return Utilities.newBlob(html, MimeType.HTML, filename + '.html')
    .getAs(MimeType.PDF)
    .setName(filename + '.pdf');
}

/** Filename-safe slug: 'RISHU AUTOMOBILE' -> 'RISHU-AUTOMOBILE'. */
function slug_(s) {
  return String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

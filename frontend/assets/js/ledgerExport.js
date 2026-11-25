/**
 * ledgerExport.js
 * Downloads the ledger exactly as it is on screen — same dealer, same period,
 * same rows, same Opening / Current Total / Closing footer — as a real Excel
 * workbook (.xlsx) or a PDF.
 *
 * Excel: Debit, Credit and Balance are true numbers (not text), in Indian
 * digit grouping, so they can be summed and filtered in Excel straight away.
 * Balance is the amount without a sign plus a separate Dr/Cr column, the way
 * Tally prints it. Dates are real Excel dates.
 *
 * Both files are built in the browser; the two libraries are fetched from
 * cdnjs only when a download is clicked (nothing extra loads with the app),
 * pinned to an exact version and checked against a hash (SRI).
 */

var LIBS = {
  exceljs: { url: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
             sri: 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz' },
  jspdf:   { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
             sri: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk' },
  autotable: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
             sri: 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3' }
};

var loading = {};
function loadLib_(name) {
  if (!loading[name]) {
    loading[name] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIBS[name].url;
      s.integrity = LIBS[name].sri;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = function () {
        delete loading[name];
        reject(new Error('Could not load the download tool. Check the internet connection and try again.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading[name];
}

export function exportLedger_(kind, data) {
  return kind === 'xlsx' ? toExcel_(data) : toPdf_(data);
}

// ================================================================ HELPERS =
var COMPANY_NAME = 'HORIZON AUTO';

/** [year, month, day] of a value's calendar day in India time. */
function istParts_(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return null;
  var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
  return [Number(p.year), Number(p.month), Number(p.day)];
}

function dmy_(value) {
  var p = istParts_(value);
  return p ? String(p[2]).padStart(2, '0') + '-' + String(p[1]).padStart(2, '0') + '-' + p[0] : '';
}

/** 'YYYY-MM-DD' from a date input -> 'DD-MM-YYYY'. */
function ymdToDmy_(ymd) {
  return ymd ? ymd.slice(8, 10) + '-' + ymd.slice(5, 7) + '-' + ymd.slice(0, 4) : '';
}

function periodText_(data) {
  if (data.from && data.to) return ymdToDmy_(data.from) + ' to ' + ymdToDmy_(data.to);
  if (data.to) return 'Up to ' + ymdToDmy_(data.to);
  if (data.from) return 'From ' + ymdToDmy_(data.from);
  return 'All transactions';
}

function fileBase_(data) {
  var period = data.from || data.to
    ? (ymdToDmy_(data.from) || 'start') + '_to_' + (ymdToDmy_(data.to) || 'today')
    : 'all';
  return 'Ledger_' + data.dealerCode + '_' + period;
}

/** 1234567.8 -> '12,34,567.80' (no currency sign: PDF base fonts have no ₹). */
function inr_(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function side_(n) {
  var v = Number(n) || 0;
  return Math.abs(v) < 0.005 ? '' : (v > 0 ? 'Dr' : 'Cr');
}

/** The table rows in a neutral shape both writers use. */
function rowsOf_(data) {
  return (data.rows || []).map(function (r) {
    var dateVal = r['Invoice Date'] || r.Date;
    return {
      date: dateVal,
      head: r.Head || '',
      invoice: r['Invoice No'] || '',
      remarks: r.Remarks || '',
      debit: Number(r.Debit) || 0,
      credit: Number(r.Credit) || 0,
      balance: Number(r['Running Balance']) || 0,
      isOpening: r.Head === 'Opening Balance' && !r['Entry ID']
    };
  });
}

function save_(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
}

// ================================================================== EXCEL =
// Indian grouping (12,34,56,789.00) — Excel's own #,##0 always groups in threes.
var INR_FMT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

function toExcel_(data) {
  return loadLib_('exceljs').then(function () {
    var ExcelJS = window.ExcelJS;
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Horizon Auto Network Connect';
    wb.created = new Date();
    var ws = wb.addWorksheet('Ledger', {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });
    ws.columns = [
      { key: 'date', width: 12 }, { key: 'head', width: 24 }, { key: 'invoice', width: 22 },
      { key: 'remarks', width: 40 }, { key: 'debit', width: 16 }, { key: 'credit', width: 16 },
      { key: 'balance', width: 17 }, { key: 'side', width: 6 }
    ];

    var title = ws.addRow([COMPANY_NAME]);
    title.font = { bold: true, size: 14 };
    ws.mergeCells('A1:H1');
    var who = ws.addRow(['Ledger: ' + (data.dealer.name ? data.dealer.name + ' (' + data.dealer.code + ')' : data.dealer.code)]);
    who.font = { bold: true, size: 12 };
    ws.mergeCells('A2:H2');
    ws.addRow(['Period: ' + periodText_(data)]).font = { color: { argb: 'FF555555' } };
    ws.mergeCells('A3:H3');
    ws.addRow([]);

    var head = ws.addRow(['Date', 'Head', 'Invoice No.', 'Particulars', 'Debit', 'Credit', 'Balance', 'Dr/Cr']);
    head.font = { bold: true };
    head.eachCell(function (c, col) {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
      c.alignment = { vertical: 'middle', horizontal: col >= 5 && col <= 7 ? 'right' : 'left' };
    });

    rowsOf_(data).forEach(function (r) {
      var p = istParts_(r.date);
      var row = ws.addRow([
        p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : '',
        r.head, r.invoice, r.remarks,
        r.debit || null, r.credit || null,
        Math.abs(r.balance), side_(r.balance)
      ]);
      row.getCell(1).numFmt = 'dd-mm-yyyy';
      [5, 6, 7].forEach(function (c) { row.getCell(c).numFmt = INR_FMT; });
      if (r.isOpening) row.font = { bold: true };
    });

    var s = data.summary;
    if (s) {
      var first = true;
      var foot = function (label, dr, cr, side, bold) {
        var row = ws.addRow(['', '', '', label, dr || null, cr || null, null, side || '']);
        row.font = { bold: !!bold };
        row.getCell(4).alignment = { horizontal: 'right' };
        [5, 6].forEach(function (c) { row.getCell(c).numFmt = INR_FMT; });
        if (first) { row.eachCell({ includeEmpty: true }, function (c) { c.border = { top: { style: 'thin' } }; }); first = false; }
        return row;
      };
      var opening = Number(s.opening) || 0, closing = Number(s.closing) || 0;
      foot('Opening Balance :', opening > 0 ? opening : null, opening < 0 ? -opening : null, side_(opening));
      foot('Current Total :', s.debit, s.credit, '');
      var c = foot('Closing Balance :', closing > 0 ? closing : null, closing < 0 ? -closing : null, side_(closing), true);
      c.eachCell({ includeEmpty: true }, function (cell) { cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; });
    }

    return wb.xlsx.writeBuffer().then(function (buf) {
      save_(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase_(data) + '.xlsx');
    });
  });
}

// ==================================================================== PDF =
function toPdf_(data) {
  return loadLib_('jspdf').then(function () { return loadLib_('autotable'); }).then(function () {
    var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(COMPANY_NAME, 14, 15);
    doc.setFontSize(11);
    doc.text('Ledger: ' + (data.dealer.name ? data.dealer.name + ' (' + data.dealer.code + ')' : data.dealer.code), 14, 22);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text('Period: ' + periodText_(data), 14, 27.5);
    doc.text('Amounts in Rs.', pageW - 14, 27.5, { align: 'right' });
    doc.setTextColor(0);

    var body = rowsOf_(data).map(function (r) {
      var cells = [dmy_(r.date), r.head, r.invoice, r.remarks,
        r.debit ? inr_(r.debit) : '', r.credit ? inr_(r.credit) : '',
        side_(r.balance) ? inr_(Math.abs(r.balance)) + ' ' + side_(r.balance) : inr_(0)];
      return r.isOpening ? cells.map(function (c) { return { content: c, styles: { fontStyle: 'bold' } }; }) : cells;
    });

    var foot = [];
    var s = data.summary;
    if (s) {
      var sideCells = function (n) {
        var v = Number(n) || 0;
        return [v > 0 ? inr_(v) : '', v < 0 ? inr_(-v) : '', side_(v)];
      };
      var label = function (t) { return { content: t, colSpan: 4, styles: { halign: 'right' } }; };
      foot.push([label('Opening Balance :')].concat(sideCells(s.opening)));
      foot.push([label('Current Total :'), inr_(s.debit), inr_(s.credit), '']);
      foot.push([label('Closing Balance :')].concat(sideCells(s.closing)));
    }

    doc.autoTable({
      startY: 32,
      head: [['Date', 'Head', 'Invoice No.', 'Particulars', 'Debit', 'Credit', 'Balance']],
      body: body,
      foot: foot,
      showFoot: 'lastPage',
      theme: 'plain',
      styles: { fontSize: 7.6, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fontStyle: 'bold', fillColor: [242, 242, 242], textColor: 20, lineWidth: { top: 0.2, bottom: 0.2 }, lineColor: 120 },
      footStyles: { fontStyle: 'bold', textColor: 20, lineWidth: { top: 0.2 }, lineColor: 120 },
      bodyStyles: { lineWidth: { bottom: 0.1 }, lineColor: 225 },
      columnStyles: {
        0: { cellWidth: 17 }, 1: { cellWidth: 25 }, 2: { cellWidth: 33 },
        4: { cellWidth: 21, halign: 'right' }, 5: { cellWidth: 21, halign: 'right' }, 6: { cellWidth: 25, halign: 'right' }
      },
      didParseCell: function (h) {
        // Right-align the money columns in the header and footer too.
        if ((h.section === 'head' || h.section === 'foot') && h.column.index >= 4) h.cell.styles.halign = 'right';
      },
      didDrawPage: function () {
        var page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(7.5); doc.setTextColor(130);
        doc.text('Horizon Auto Network Connect · generated ' + dmy_(new Date()), 14, doc.internal.pageSize.getHeight() - 8);
        doc.text('Page ' + page, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
        doc.setTextColor(0);
      }
    });

    save_(doc.output('blob'), fileBase_(data) + '.pdf');
  });
}

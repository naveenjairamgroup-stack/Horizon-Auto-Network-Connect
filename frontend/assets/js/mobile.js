/**
 * mobile.js
 * Phone-sized screens: the slide-in menu, and wide tables shown as cards.
 *
 * Tables: on a phone a 9-column table can only be squeezed or scrolled
 * sideways, and both are hard to read. Instead every table with
 * CARD_MIN_COLUMNS or more columns is tagged `rtable`, and each body cell gets
 * a data-label copied from its column heading; styles.css then shows each row
 * as a card of "label  value" lines below 768px. Desktop ignores both.
 *
 * Doing this here, on whatever lands in the page, means the dozen screens
 * that build their rows with innerHTML need no changes of their own — and a
 * new screen gets it for free.
 */

export function toggleSidebar() {
  document.body.classList.toggle('nav-open');
}

export function closeSidebar() {
  document.body.classList.remove('nav-open');
}

// Two- and three-column tables (dashboard summary, settings) fit a phone as
// they are; turning them into cards would only make them longer.
var CARD_MIN_COLUMNS = 4;

function columnLabels_(table) {
  var head = table.tHead;
  if (!head || !head.rows.length) return [];
  var labels = [];
  Array.prototype.forEach.call(head.rows[head.rows.length - 1].cells, function (th) {
    var text = th.textContent.replace(/\s+/g, ' ').trim();
    for (var i = 0; i < (th.colSpan || 1); i++) labels.push(text);
  });
  return labels;
}

function labelTable_(table) {
  var labels = columnLabels_(table);
  if (labels.length < CARD_MIN_COLUMNS) return;
  table.classList.add('rtable');
  Array.prototype.forEach.call(table.tBodies, function (tbody) {
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      if (tr.getAttribute('data-rt') === '1') return;
      var col = 0;
      Array.prototype.forEach.call(tr.cells, function (td) {
        var span = td.colSpan || 1;
        // A cell spanning several columns is a message ("No payments…"),
        // not a value, so it gets no label and runs full width.
        if (span > 1) td.classList.add('rt-span');
        else td.setAttribute('data-label', labels[col] || '');
        col += span;
      });
      tr.setAttribute('data-rt', '1');
    });
  });
}

var scanQueued = false;

function scan_() {
  scanQueued = false;
  document.querySelectorAll('table').forEach(labelTable_);
}

/**
 * Labels every table now, and again whenever rows are added. Only childList
 * changes are watched, so setting the labels (attributes) never re-triggers
 * it; bursts of row appends are folded into one pass per frame.
 */
export function initMobileTables() {
  scan_();
  new MutationObserver(function () {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan_);
  }).observe(document.body, { childList: true, subtree: true });
}

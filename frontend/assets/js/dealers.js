/**
 * dealers.js
 * One shared, cached dealer list for every dealer dropdown in the app
 * (Payments, Returns, Bulk entry, filters). Fetched once per login instead of
 * once per screen.
 */
import { api } from './api.js';
import { session } from './session.js';

var cache = null;
var inflight = null;

export function getDealers_() {
  if (session.role === 'Dealer') {
    return Promise.resolve([{ 'Dealer Code': session.dealerCode, 'Dealer Name': session.fullName || session.dealerCode }]);
  }
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api('listDealers', session.token).then(function (d) {
      cache = (d || []).slice().sort(function (a, b) {
        return String(a['Dealer Name']).localeCompare(String(b['Dealer Name']));
      });
      inflight = null;
      return cache;
    }, function (err) { inflight = null; throw err; });
  }
  return inflight;
}

/** Call after a dealer is created or renamed. */
export function clearDealerCache_() { cache = null; }

/**
 * Fills a <select> with "Name — Code" options whose value is the dealer
 * code, so existing code that reads select.value keeps working unchanged.
 * opts.blank: label for an empty first option (e.g. "All dealers").
 * A Dealer login gets just its own dealer, pre-selected and locked.
 */
export function fillDealerSelect_(el, opts) {
  if (!el) return Promise.resolve();
  opts = opts || {};
  var keep = el.value;
  return getDealers_().then(function (dealers) {
    el.innerHTML = '';
    if (opts.blank !== undefined && session.role !== 'Dealer') {
      var b = document.createElement('option');
      b.value = '';
      b.textContent = opts.blank;
      el.appendChild(b);
    }
    dealers.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d['Dealer Code'];
      o.textContent = d['Dealer Name'] + ' \u2014 ' + d['Dealer Code'];
      el.appendChild(o);
    });
    if (keep) el.value = keep;
    el.disabled = session.role === 'Dealer';
  });
}

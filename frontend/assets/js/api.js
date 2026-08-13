/**
 * api.js
 * Calls our own Cloudflare Pages Function at /api (see
 * frontend/functions/api.js), which proxies the request to the Apps
 * Script backend server-side. Because the browser only ever talks to its
 * own domain, this is a same-origin request — no CORS, no ORB, no
 * Workspace-domain quirks, no matter how Apps Script itself behaves.
 *
 * Every backend function still returns the same {success, data|error}
 * shape it always did (via safeRun() — completely unchanged there), so
 * this resolves/rejects a Promise exactly like before. Every page module
 * calls it the same way:
 *   api('listDealers', session.token).then(...).catch(...)
 */
export function api(fnName) {
  var args = Array.prototype.slice.call(arguments, 1);
  return fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fnName, args: args })
  })
    .then(function (response) {
      if (!response.ok) throw new Error('Network error (' + response.status + ') calling ' + fnName);
      return response.json();
    })
    .then(function (res) {
      if (res && res.success === false) throw new Error(res.error);
      return res && res.data !== undefined ? res.data : res;
    });
}

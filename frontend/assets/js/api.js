/**
 * api.js
 * Uses JSONP (a <script> tag) instead of fetch() — this specific Apps
 * Script Workspace-domain deployment doesn't reliably send the CORS
 * header fetch() needs, on GET or POST. A <script> tag isn't subject to
 * that CORS check at all, so this works regardless.
 */
import { BACKEND_URL } from './config.js';

let callbackCounter = 0;

export function api(fnName) {
  var args = Array.prototype.slice.call(arguments, 1);
  return fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fnName, args: args })
  }).then(function (response) {
    return response.json();
  }).then(function (res) {
    if (res && res.success === false) {
      throw new Error(res.error);
    }
    return res && res.data !== undefined ? res.data : res;
  }).catch(function () {
    throw new Error('Network error calling ' + fnName);
  });
}
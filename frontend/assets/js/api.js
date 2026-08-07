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
  return new Promise(function (resolve, reject) {
    var callbackName = '__api_cb_' + (callbackCounter++) + '_' + Date.now();
    var script = document.createElement('script');

    var cleanup = function () {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[callbackName] = function (res) {
      cleanup();
      if (res && res.success === false) { reject(new Error(res.error)); return; }
      resolve(res && res.data !== undefined ? res.data : res);
    };

    script.onerror = function () {
      cleanup();
      reject(new Error('Network error calling ' + fnName));
    };

    var url = BACKEND_URL + '?fn=' + encodeURIComponent(fnName) +
      '&args=' + encodeURIComponent(JSON.stringify(args)) +
      '&callback=' + encodeURIComponent(callbackName);
    script.src = url;
    document.head.appendChild(script);
  });
}
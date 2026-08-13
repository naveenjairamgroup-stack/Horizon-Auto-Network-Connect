/**
 * frontend/functions/api.js
 * Cloudflare Pages Function — handles requests to /api.
 *
 * Why this exists: the frontend was calling the Apps Script Web App URL
 * directly from the browser (fetch, then a JSONP <script> tag fallback),
 * and both failed — the Apps Script deployment doesn't reliably send the
 * CORS header a cross-origin fetch() needs, and Chrome's ORB (Opaque
 * Response Blocking) rejected the JSONP <script> tag's response too. This
 * is a known rough edge with some Google Workspace-domain Apps Script
 * deployments, not something fixable from the browser side alone.
 *
 * The fix: don't call Apps Script from the browser at all. Call it from
 * HERE instead — a Cloudflare Pages Function, which runs server-side.
 * Server-to-server requests are never subject to browser CORS rules in the
 * first place, so this sidesteps the whole problem permanently, regardless
 * of anything on the Apps Script/Workspace side. The browser now only ever
 * talks to its own domain (same-origin `/api`), which is as CORS-free as
 * it gets.
 *
 * Configuration: set an environment variable named APPS_SCRIPT_URL in the
 * Cloudflare Pages project (Settings → Environment variables) to your
 * Apps Script Web App's /exec URL. See docs/DEPLOYMENT_GUIDE.md.
 *
 * ---------------------------------------------------------------------
 * WHY THERE'S A RETRY LOOP BELOW
 * ---------------------------------------------------------------------
 * Apps Script Web Apps occasionally answer with an HTML page instead of
 * the expected JSON — a redirect/auth interstitial, a "service invoked too
 * many times" quota page, or an execution-timeout page — even though the
 * HTTP status looks fine. This shows up in the browser as a cryptic
 * "Unexpected token '<', "<!DOCTYPE"... is not valid JSON" error, and it's
 * intermittent by nature (a transient hiccup on Google's serving layer,
 * not a bug in any specific request). Blindly passing that HTML through as
 * if it were JSON — which this proxy used to do — means the frontend
 * crashes on `.json()` instead of getting a clear error. Retrying a couple
 * of times, right here before ever reaching the browser, papers over the
 * transient case (which is most of them) and gives a clean, honest error
 * for the rest instead of raw HTML.
 * ---------------------------------------------------------------------
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400; // multiplied by attempt number, so 400ms then 800ms

export async function onRequestPost(context) {
  const backendUrl = context.env.APPS_SCRIPT_URL;
  if (!backendUrl) {
    return jsonError_(500, 'Server misconfiguration: APPS_SCRIPT_URL environment variable is not set in Cloudflare Pages.');
  }

  const body = await context.request.text();
  let lastFailureReason = 'Unknown error.';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let text;
    try {
      const resp = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body
      });
      text = await resp.text();
    } catch (err) {
      lastFailureReason = 'Could not reach the backend: ' + err.message;
      await maybeWaitThenContinue_(attempt);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      // This is the "Apps Script sent HTML instead of JSON" case — retry.
      lastFailureReason = 'Backend returned a non-JSON response (a transient Apps Script hiccup, not a code bug).';
      await maybeWaitThenContinue_(attempt);
      continue;
    }

    // Got real JSON back — success, regardless of which attempt it took.
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Every attempt failed — tell the frontend clearly instead of handing it raw HTML.
  return jsonError_(502, lastFailureReason + ' Tried ' + MAX_ATTEMPTS + ' times. Please try again in a moment.');
}

async function maybeWaitThenContinue_(attempt) {
  if (attempt < MAX_ATTEMPTS) {
    await sleep_(RETRY_DELAY_MS * attempt);
  }
}

function sleep_(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function jsonError_(status, message) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// A GET to /api (e.g. opened directly in a browser) is just a liveness
// check — the real app always POSTs.
export async function onRequestGet() {
  return new Response(
    JSON.stringify({ success: true, message: 'API proxy is running. The app calls this with POST.' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

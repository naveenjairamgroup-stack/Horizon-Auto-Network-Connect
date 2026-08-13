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
 */
export async function onRequestPost(context) {
  const backendUrl = context.env.APPS_SCRIPT_URL;
  if (!backendUrl) {
    return new Response(
      JSON.stringify({ success: false, error: 'Server misconfiguration: APPS_SCRIPT_URL environment variable is not set in Cloudflare Pages.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await context.request.text();

  let resp;
  try {
    resp = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Could not reach the backend: ' + err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const text = await resp.text();
  return new Response(text, {
    status: 200,
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

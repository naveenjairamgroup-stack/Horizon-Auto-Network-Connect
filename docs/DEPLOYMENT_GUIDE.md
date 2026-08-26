# Deployment Guide

Two independent deployments, connected by one Cloudflare Pages Function
acting as a proxy.

```
Browser ──same-origin──▶ Cloudflare Pages Function (/api)  ──server-to-server──▶  Apps Script Web App ──▶ Google Sheet
```

The browser never talks to Apps Script directly. It calls `/api` on its own
domain; a small Cloudflare Pages Function (`frontend/functions/api.js`)
forwards that request to Apps Script server-side and returns the result.
See "Why a proxy?" below for why this exists.

---

## Part 1 — Backend (Google Apps Script)

### 1.1 One-time: install clasp and log in

```bash
npm install -g @google/clasp
clasp login
```

This opens a browser to authorize clasp against your Google account (the
same one that owns the Apps Script project / the Google Sheet).

### 1.2 Connect this repo's `backend/` folder to your existing Apps Script project

Grab your Apps Script project's **Script ID**: open it in the Apps Script
editor → Project Settings (⚙️ gear icon) → "Script ID".

Paste it into `backend/.clasp.json`:

```json
{
  "scriptId": "PASTE_YOUR_APPS_SCRIPT_ID_HERE",
  "rootDir": "."
}
```

### 1.3 Push the code

```bash
cd backend
clasp push
```

This uploads every `.gs` file here to the Apps Script project, **replacing**
whatever is currently there.

> First time only: also run `setupDatabase()` from the Apps Script editor
> if you haven't already (creates/migrates all the Sheet tabs).

### 1.4 Deploy as a Web App

**Deploy → Manage deployments → pencil icon → New version → Deploy.**
Confirm:

- Execute as: **Me**
- Who has access: **Anyone**

Copy the **plain** `/exec` URL — the one shaped like
`https://script.google.com/macros/s/AKfycb.../exec` (no `/a/macros/yourdomain.com/`
in it). You need it in step 2.2.

---

## Part 2 — Frontend (Cloudflare Pages via GitHub)

### 2.1 Connect Cloudflare Pages to this repo (one-time)

**Workers & Pages → Create → Pages → Connect to Git** → pick this
repository. Build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `frontend` |

No build command is needed — plain static HTML/CSS/JS, Cloudflare just
serves the `frontend/` folder as-is (and automatically runs the Function in
`frontend/functions/`). Every push to your main branch auto-deploys.

### 2.2 Tell the proxy where your backend is

In the Cloudflare dashboard: your Pages project → **Settings → Environment
variables** → **Add variable**:

| Name | Value |
|---|---|
| `APPS_SCRIPT_URL` | the `/exec` URL from step 1.4 |

Add it for **both** Production and Preview environments. After adding it,
**redeploy** (Deployments tab → ⋯ on the latest → Retry deployment) —
environment variable changes only take effect on a new deployment.

> This is the *only* place the Apps Script URL lives. The browser-side code
> never sees it — it only ever calls `/api` on its own domain.

### 2.3 If you edited a page fragment

`frontend/index.html` is generated from the files under `frontend/pages/`.
If you change any of those, regenerate it before committing:

```bash
cd frontend
python3 build.py
```

---

## Part 3 — Commission module setup (one-time, after deploying)

The commission module needs three things done once, in this order.

### 3.1 Create the new sheet tabs

In the Apps Script editor, pick `setupDatabase` from the function dropdown and
Run. It adds four tabs — `Commission_Rate_Master`, `Commission_Config`,
`Commission_Report`, `Commission_Report_Line` — and seeds the config defaults
(registration ₹500, insurance 13%, SGST 9%, CGST 9%).

Safe to re-run: it only fills in what's missing and never touches existing data.
The old `Commission_Master` and `Commission_Entries` tabs are deliberately left
alone — nothing reads them any more, so you can ignore or delete them.

### 3.2 Set the commission PIN

Log in as Admin → **Commission → Settings → Commission PIN**. Until this is set,
nobody can add or change a commission rate.

One PIN for everyone. Admin, Accounts and Network Manager all use it; entering
it unlocks rate editing for 10 minutes. Only Admin can set or reset it, and it
is stored hashed — a forgotten PIN is replaced, never recovered.

### 3.3 Configure per-dealer insurance rates

The default is 13%. For each ASC that gets a different rate, go to
**Commission → Settings → Change a setting**:

- Setting: *Insurance commission (%)*
- Dealer code: the ASC's code (blank means all dealers)
- Value: e.g. `6.5`
- Effective from: the date it starts

Same append-only rule as rates: a change writes a new row and the old value
stays as history.

### 3.4 Turn on the monthly schedule

In the Apps Script editor, run `setupCommissionTriggers` once. This sets:

- **1st of the month, 09:00** — checkpoint. Any ASC whose sales include a Model
  Variant with no rate on file is flagged, and a notification is raised so
  there's a day to fix it.
- **2nd of the month, 09:00** — generate. Every ASC that came through the
  checkpoint clean gets its report for the previous month.

Safe to re-run; it clears its own previous triggers first. You can also run
either step by hand from **Commission → Checkpoint** at any time.

### 3.5 Add the commission rates

Rates are entered through the UI, not imported: **Commission → Commission
rates → + Add model**.

You don't need to enter all of them up front. Run the checkpoint for the month
you're working on — every variant that's missing a rate is listed with an
**Add rate** button next to it, so you only ever enter the variants that
actually sold.

---

## Why a proxy? (what actually went wrong, and why this fixes it)

`google.script.run` — the usual way an Apps Script page talks to its own
backend — only works when the HTML is served *by* Apps Script itself. Since
the frontend lives on Cloudflare Pages (a different domain), it can't use
that at all.

The next thing to reach for is normally a plain cross-origin `fetch()` —
Apps Script Web Apps are supposed to send an `Access-Control-Allow-Origin`
header on their responses so this works. In practice, **this specific
deployment (a Google Workspace domain-restricted Apps Script project)
doesn't reliably send that header**, on GET or POST. A `<script>`-tag/JSONP
workaround was tried next, since script tags aren't subject to CORS at all
— but Chrome's ORB (Opaque Response Blocking, a newer security feature)
rejected that too, because Apps Script's response headers weren't exactly
what ORB wants from something loaded as a script.

Both of those failure modes are specific to **browser** cross-origin rules.
Server-to-server requests aren't cross-origin at all — there's no browser
involved to enforce CORS — so a tiny server-side proxy sidesteps the entire
problem, permanently, regardless of any Workspace-side quirk. That's what
`frontend/functions/api.js` is: a Cloudflare Pages Function (runs
server-side, next to your static files, zero extra hosting needed) that
receives the browser's request on `/api` and forwards it to Apps Script
itself. The browser only ever calls its own domain.

Every backend function's business logic — validation, `safeRun()` error
wrapping, everything — is completely unchanged; only the transport hop in
the middle is new.

---

## Troubleshooting

**"Server misconfiguration: APPS_SCRIPT_URL environment variable is not set"**
You skipped or mistyped step 2.2, or added the variable but haven't
redeployed since. Environment variable changes need a fresh deployment to
take effect.

**Login just spins / "Could not reach the backend"**
The `APPS_SCRIPT_URL` value itself is wrong or stale — re-copy it from
Apps Script (Deploy → Manage deployments), making sure it's the plain
`script.google.com/macros/s/.../exec` form, not the `/a/macros/yourdomain/`
form.

**A specific feature works but a new function you added doesn't work at all**
You likely forgot to add the new function to `API_DISPATCH` in
`backend/Code.gs` — anything not listed there is refused, on purpose (see
README §"Adding a new backend function").

**Everything worked yesterday, nothing works today, no code changed**
Check the Apps Script deployment is still live (Deploy → Manage
deployments) — redeploying a *new version* is required after any `clasp
push`; pushing code alone does not update the live `/exec` URL's behaviour.

**Testing locally**
Plain static servers (`npx serve`, VS Code Live Server, etc.) don't run
Cloudflare Pages Functions, so `/api` won't exist and every call will fail
locally that way. Either test against the real deployed Cloudflare Pages
URL, or run `npx wrangler pages dev frontend` locally, which does emulate
Functions (you'll need to pass the env var: `npx wrangler pages dev
frontend --binding APPS_SCRIPT_URL="https://script.google.com/macros/s/.../exec"`).

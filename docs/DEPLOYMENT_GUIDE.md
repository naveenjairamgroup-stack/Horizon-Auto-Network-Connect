# Deployment Guide

Two independent deployments, connected by one URL.

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

If you already have the Apps Script project (the one bound to your Google
Sheet database) open in the Apps Script editor, grab its **Script ID**:
Project Settings (⚙️ gear icon) → "Script ID".

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
whatever is currently there. Since this `backend/` folder already contains
every original file plus the new `Code.gs` (API dispatcher), a push here is
a complete, correct replacement — nothing manual to reconcile.

> First time only: also run `setupDatabase()` from the Apps Script editor
> if you haven't already (creates/migrates all the Sheet tabs). This is
> unrelated to the frontend move — same one-time step as before.

### 1.4 Deploy as a Web App

In the Apps Script editor: **Deploy → Manage deployments → pencil icon →
New version → Deploy**. Confirm the settings are:

- Execute as: **Me**
- Who has access: **Anyone**

(`backend/appsscript.json` already encodes this — `ANYONE_ANONYMOUS` /
`USER_DEPLOYING` — so a fresh deploy should keep it right automatically.)

Copy the `/exec` URL shown — you need it for the frontend next.

---

## Part 2 — Frontend (Cloudflare Pages via GitHub)

### 2.1 Point the frontend at your backend

Open `frontend/assets/js/config.js` and paste the `/exec` URL from step 1.4:

```js
export const BACKEND_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Commit this change every time you redeploy the backend and get a new URL.

### 2.2 Connect Cloudflare Pages to this repo (one-time)

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect
to Git** → pick this repository. Build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `frontend` |

No build command is needed — this is plain static HTML/CSS/JS, so Cloudflare
just serves the `frontend/` folder as-is. Every push to your main branch
auto-deploys.

### 2.3 If you edited a page fragment

`frontend/index.html` is generated from the files under `frontend/pages/`.
If you change any of those, regenerate it before committing:

```bash
cd frontend
python3 build.py
```

(Plain Python 3, no dependencies — this only runs on your machine, never on
Cloudflare.)

---

## Why the transport had to change (CORS, in one paragraph)

`google.script.run` — the usual way an Apps Script page talks to its own
backend — only exists when the HTML is served *by* Apps Script itself.
Since the frontend now lives on a different domain (Cloudflare Pages), it
calls the backend as a plain HTTP API instead (see `frontend/assets/js/api.js`
and `backend/Code.gs`). Requests are sent as `POST` with
`Content-Type: text/plain` — deliberately *not* `application/json` — because
a JSON content type forces the browser to send a CORS "preflight" `OPTIONS`
request first, and Apps Script Web Apps have no way to answer an `OPTIONS`
request. `text/plain` is treated as a "simple request", so no preflight
happens, and Apps Script can still `JSON.parse()` the body just fine on its
end. Every function's business logic — validation, safeRun() error
wrapping, everything — is completely unchanged; only this one transport
detail is new.

---

## Troubleshooting

**Login just spins / fails with a generic network error**
Open the browser console (F12). A CORS error naming your Cloudflare Pages
domain almost always means `BACKEND_URL` in `config.js` is wrong, stale (an
old deployment ID), or the Apps Script deployment's access isn't set to
"Anyone". Re-check step 1.4 and 2.1.

**A specific feature works from Admin but a new function you added doesn't work at all**
You likely forgot to add the new function to `API_DISPATCH` in
`backend/Code.gs` — anything not listed there is refused, on purpose (see
README §"Adding a new backend function").

**Everything worked yesterday, nothing works today, no code changed**
Check the Apps Script deployment is still live (Deploy → Manage
deployments) — redeploying a *new version* is required after any `clasp
push`; pushing code alone does not update the live `/exec` URL's behaviour
until you deploy a new version pointing at HEAD.

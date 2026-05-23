# SF Meta Exporter — Web Edition

---

## What's in the app

### Auth
- **Login page** — Consumer Key input, org type selector (Production / Sandbox / Custom Domain)
- **OAuth 2.0 PKCE flow** — secure, passwordless login via popup window
- **Session management** — encrypted `httpOnly` cookie via `iron-session`
- **Auto-redirect** — `/` routes to `/dashboard` if authenticated, `/login` if not

### Modules (all live)
- **Picklist Exporter** — exports all picklist and multi-select fields including active/inactive values, Global Value Set detection, and per-object summary as a styled `.xlsx`
- **Metadata Exporter** — exports all fields for selected objects as a 15-column Excel file, with optional field descriptions and field usage analysis
- **File Downloader** — downloads Salesforce ContentDocuments and their versions
- **SOQL Runner** — interactive query editor with Monaco, autocomplete, history, CSV/Excel export, and live API usage display
- **SF Switch** — load and toggle automation components (Validation Rules, Workflow Rules, Flows, Apex Triggers)
- **Report Exporter** — exports selected Salesforce reports via the Analytics API

---

## Quick start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
SESSION_SECRET=your-super-secret-password-at-least-32-chars
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run locally
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Salesforce setup (one-time per org)

You need a **Consumer Key** from a Salesforce External Client App.

1. In Salesforce: **Setup → App Manager → New External Client App**
2. Fill in:
   - App Name: `SF Meta Exporter`
   - Callback URL: `http://localhost:3000/auth/callback`
     *(add your production URL too when deploying)*
   - OAuth Scopes: `api`, `refresh_token`
3. Click **Save**, then copy the **Consumer Key**
4. Paste it into the login page

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Set these environment variables in the Vercel dashboard:
- `SESSION_SECRET` — at least 32 random characters
- `NEXT_PUBLIC_APP_URL` — your Vercel app URL (e.g. `https://sfmeta.vercel.app`)

Add your Vercel app URL as an additional **Callback URL** in your Salesforce External Client App.

---

## Project structure

```
app/
  (auth)/login/page.js          ← Login UI
  auth/callback/page.js         ← OAuth popup callback
  dashboard/
    layout.js                   ← Session guard + sidebar
    page.js                     ← Module cards overview
    picklist/page.js            ← Picklist Exporter UI
    metadata/page.js            ← Metadata Exporter UI
    files/page.js               ← File Downloader UI
    soql/page.js                ← SOQL Runner UI
    switch/page.js              ← SF Switch UI
    reports/page.js             ← Report Exporter UI
  api/
    auth/                       ← OAuth initiate, exchange, logout, session
    picklist/export/            ← Picklist export + download
    metadata/export/            ← Metadata export + download
    content/export/             ← File download export
    soql/execute/               ← SOQL query runner
    soql/fields/                ← Field autocomplete for Monaco
    objects/                    ← SObject list for selectors
    switch/load/                ← Load automation components
    switch/deploy/              ← Deploy automation changes
    reports/export/             ← Report export
    reports/folders/            ← Report folder listing

lib/
  session.js                    ← iron-session config
  config.js                     ← Constants
  rateLimit.js                  ← Per-route API rate limiter
  jobs/store.js                 ← In-memory export job store (→ Redis in future)
  salesforce/client.js          ← SF API wrapper with API usage tracking
  salesforce/fieldUsage.js      ← Field usage query logic
  salesforce/switch/index.js    ← Automation component loaders/deployers
  streaming/sse.js              ← SSE stream helpers
  files/excel.js                ← Excel file generation
  files/csv.js                  ← CSV file generation

components/
  Sidebar.js                    ← Dashboard navigation (logo clicks back to dashboard)
  ObjectSelector.js             ← Reusable object picker
  StatusLog.js                  ← Scrolling log panel
  DownloadButton.js             ← Post-export download trigger
  ExportButton.js               ← Export initiator with disabled state
  ProgressBar.js                ← Export progress indicator
  SetupGuide.js                 ← First-time setup walkthrough
```

---

## Known limitations

- **Export job store is in-memory** — on Vercel, a download request hitting a different warm instance than the one that ran the export will get a 404. Fine for exports that complete quickly. Redis integration planned for a future update.
- **`xlsx` is pinned to 0.18.5** — v0.19+ moved to a commercial license. Do not bump this dependency.
- **Rate limiting is per-instance** — the in-memory rate limiter resets on Vercel cold starts. Acceptable as a guard; will share state with Redis in the same future update as the job store.

---

## Phase roadmap

| Phase | Module | Status |
|-------|--------|--------|
| 1 | Auth + Shell | ✅ Done |
| 2 | Core infrastructure (SSE, file gen) | ✅ Done |
| 3 | Picklist Exporter | ✅ Done |
| 4 | Metadata Exporter + Field Usage | ✅ Done |
| 5 | ContentDocument Downloader | ✅ Done |
| 6 | SOQL Runner | ✅ Done |
| 7 | SF Switch + Trigger Deployer | ✅ Done |
| 8 | Report Exporter | ✅ Done |
| 9 | Redis job store + cross-instance rate limiting | Upcoming |
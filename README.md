# SF Meta Exporter — Web Edition

A Next.js 15 web app for Salesforce admins and developers. Authenticate once with OAuth and export picklists, field metadata, reports, files, and full org backups — all streamed to your browser in real time.

---

## Modules

| Module | What it does |
|---|---|
| **Picklist Exporter** | Exports all picklist and multi-select fields across selected objects, including active/inactive values, Global Value Set detection, and per-object summaries as a styled `.xlsx` |
| **Metadata Exporter** | Exports all fields for selected objects as a 15-column Excel file with optional field descriptions and field usage analysis |
| **File Downloader** | Downloads Salesforce `ContentDocument` records and their versions |
| **SOQL Runner** | Interactive query editor with Monaco, field autocomplete, query history, live API usage display, and CSV/Excel export |
| **SF Switch** | Load and toggle automation components — Validation Rules, Workflow Rules, Flows, and Apex Triggers |
| **Report Exporter** | Exports selected Salesforce reports via the Analytics API |
| **Backup & Restore** | Backs up selected objects to a ZIP of CSVs, then restores from that ZIP with topological dependency sorting and batch inserts |

---

## Quick start

**Requirements:** Node.js ≥ 18.18.0

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
SESSION_SECRET=your-super-secret-password-at-least-32-chars
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`SESSION_SECRET` must be at least 32 characters. It encrypts the `httpOnly` session cookie.

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Salesforce setup (one-time per org)

You need a **Consumer Key** from a Salesforce External Client App.

1. In Salesforce: **Setup → App Manager → New External Client App**
2. Fill in:
   - **App Name:** `SF Meta Exporter`
   - **Callback URL:** `http://localhost:3000/auth/callback` *(add your production URL too when deploying)*
   - **OAuth Scopes:** `api`, `refresh_token`
3. Click **Save**, then copy the **Consumer Key**
4. Paste it into the login page when you open the app

The app uses OAuth 2.0 PKCE — no passwords are stored.

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Set these environment variables in the Vercel dashboard:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | At least 32 random characters |
| `NEXT_PUBLIC_APP_URL` | Your Vercel app URL, e.g. `https://sfmeta.vercel.app` |

Then add your Vercel app URL as an additional **Callback URL** in your Salesforce External Client App.

### Large restore body limit

For orgs with more than ~50k records, the default Next.js 4 MB body size limit will reject the restore POST. The `next.config.js` in this repo already sets it to 50 MB:

```js
experimental: {
  serverActions: { bodySizeLimit: '50mb' }
}
```

Raise this value further if you back up very large orgs.

---

## Project structure

```
app/
  (auth)/login/page.js            ← Login UI (Consumer Key input, org type selector)
  auth/callback/page.js           ← OAuth PKCE popup callback
  dashboard/
    layout.js                     ← Session guard + sidebar wrapper
    page.js                       ← Module cards overview
    picklist/page.js              ← Picklist Exporter UI
    metadata/page.js              ← Metadata Exporter UI
    files/page.js                 ← File Downloader UI
    soql/page.js                  ← SOQL Runner UI
    switch/page.js                ← SF Switch UI
    reports/page.js               ← Report Exporter UI
    backup/page.js                ← Backup & Restore UI (two-tab)
  api/
    auth/                         ← OAuth initiate, exchange, logout, session
    picklist/export/              ← Picklist export + download
    metadata/export/              ← Metadata export + download
    content/export/               ← File download export
    soql/execute/                 ← SOQL query execution
    soql/fields/                  ← Field autocomplete for Monaco
    objects/                      ← SObject list for selectors
    switch/load/                  ← Load automation components
    switch/deploy/                ← Deploy automation changes
    reports/export/               ← Report export
    reports/folders/              ← Report folder listing
    backup/export/                ← Backup to ZIP (SSE stream)
    backup/download/[jobId]/      ← Serve completed backup ZIP
    backup/restore/               ← Restore from ZIP (SSE stream)

lib/
  session.js                      ← iron-session config
  config.js                       ← API version, URL constants, filename templates
  rateLimit.js                    ← Per-route sliding-window rate limiter
  models.js                       ← Stat shape factories (createBackupStats, etc.)
  jobs/store.js                   ← In-memory export job store
  salesforce/client.js            ← SF REST API wrapper with API usage tracking
  salesforce/fieldUsage.js        ← Field usage query logic
  salesforce/errors.js            ← Error classification helpers
  salesforce/retry.js             ← Retry-with-backoff wrapper
  salesforce/switch/index.js      ← Automation component loaders/deployers
  streaming/sse.js                ← SSE stream helpers (emit, progress, done)
  files/excel.js                  ← Excel file generation (xlsx-js-style)
  files/csv.js                    ← CSV file generation
  files/download.js               ← File download helpers

components/
  Sidebar.js                      ← Dashboard navigation
  ObjectSelector.js               ← Reusable SObject picker with search
  StatusLog.js                    ← Scrolling real-time log panel
  DownloadButton.js               ← Post-export download trigger
  ExportButton.js                 ← Export initiator with disabled/loading state
  ProgressBar.js                  ← SSE-driven progress indicator
  StatsSummary.js                 ← Per-run summary stats display
  SetupGuide.js                   ← First-time setup walkthrough
  ToggleSwitch.js                 ← Toggle input component

hooks/
  useExport.js                    ← Shared SSE export lifecycle hook
```

---

## How Backup & Restore works

### Backup

1. Select objects via the ObjectSelector
2. The server describes each object to get all queryable fields, runs `query_all()`, and streams records to CSV
3. All CSVs plus a `metadata.json` are packaged into a ZIP and stored via the job store
4. The client downloads the ZIP — the format is compatible with SFRewind backups

Compound field types (`address`, `location`) and binary fields (`base64`) are excluded automatically because they can't be represented as CSV cells or would inflate the ZIP beyond practical limits.

### Restore

1. Drop a backup ZIP onto the Restore tab
2. JSZip parses it client-side — `metadata.json` and CSV strings are extracted in the browser
3. The parsed data is POSTed to `/api/backup/restore` as JSON
4. The server resolves the import order using a topological sort (Kahn's algorithm) to respect object relationships
5. For each object: describe to get createable fields, filter CSV columns to match, then batch-insert 200 records at a time using the Composite SObjects API
6. An SSE progress stream reports per-object results in real time

---

## Known limitations

**In-memory job store** — On Vercel, if a download request lands on a different warm instance than the one that ran the export, it returns a 404. This is acceptable for exports that complete within a single request lifecycle. Redis integration is planned.

**Per-instance rate limiting** — The sliding-window rate limiter (60 req/min for queries, 20 req/min for exports) resets on Vercel cold starts and is not shared across instances. It works as a reasonable guard; Redis will replace it in the same update as the job store.

**`xlsx` pinned to 0.18.5** — Version 0.19 and above switched to a commercial license (SheetJS Pro). Do not bump this dependency.

---

## Tech stack

- **Framework:** Next.js 15, React 19
- **Styling:** Tailwind CSS
- **Auth:** OAuth 2.0 PKCE + iron-session (encrypted `httpOnly` cookie)
- **Editor:** Monaco Editor (`@monaco-editor/react`)
- **Streaming:** Server-Sent Events (SSE) for all long-running exports
- **Excel output:** `xlsx` 0.18.5 + `xlsx-js-style`
- **ZIP handling:** JSZip
- **SF API version:** v64.0 (v65+ permanently removed SOAP `login()`)
- **Deployment target:** Vercel (configured in `vercel.json`)

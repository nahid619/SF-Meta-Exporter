# SF Meta Exporter — All Patches

## What's in this ZIP

Two sets of changes, bundled together:

### 1. Login retry fix (3 files — earlier patch)
- `app/api/auth/initiate/route.js` — adds `prompt=login` so SF always shows the login form on retry
- `app/auth/callback/page.js` — auto-closes popup on error after 2.5s
- `app/(auth)/login/page.js` — fresh popup per attempt, reset button, defer localStorage save

### 2. Backup & Restore module — Module 7 (8 files — new)

#### New routes
- `app/api/backup/export/route.js` — POST, SSE stream; queries selected objects → ZIP of CSVs + metadata.json
- `app/api/backup/download/[jobId]/route.js` — GET; serves completed backup ZIP
- `app/api/backup/restore/route.js` — POST, SSE stream; parses backup data, sorts by dependency, batch-inserts

#### New page
- `app/dashboard/backup/page.js` — Two-tab UI (Backup + Restore)

#### Updated shared files
- `components/Sidebar.js` — adds 7th nav item (🔁 Backup & Restore)
- `components/StatsSummary.js` — adds stat keys for totalRecords, totalRecordsInserted, totalRecordsFailed
- `lib/models.js` — adds createBackupStats() and createRestoreStats()
- `lib/salesforce/client.js` — adds batchInsert() method (Composite Sobjects API)

## Install

Drop these files over your project root — paths match exactly.
No new npm dependencies needed (JSZip is already in package.json).
Restart `next dev` after copying.

## How it works

### Backup
1. Select objects via the existing ObjectSelector
2. Server describes each object to get queryable fields, runs query_all(), streams records to CSV
3. All CSVs + metadata.json are zipped and stored via the jobs store
4. User downloads the ZIP — format is compatible with SFRewind backups

### Restore
1. User drops a backup ZIP onto the page
2. JSZip parses it client-side — metadata.json + CSV strings extracted in the browser
3. Parsed data is POSTed to /api/backup/restore as JSON
4. Server resolves import order via topological sort (Kahn's algorithm)
5. For each object: describe to get createable fields, filter CSV columns, batch-insert 200 at a time
6. SSE progress stream shows per-object results

### Note on request size for large restores
Next.js defaults to a 4 MB body size limit. For backups with >50k records,
add this to next.config.js:
  experimental: { serverActions: { bodySizeLimit: '50mb' } }

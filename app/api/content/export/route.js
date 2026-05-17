/**
 * POST /api/content/export
 *
 * Mirrors content_document_exporter.py exactly.
 *
 * Flow:
 *   1. Query all ContentDocuments (paginated)
 *   2. Query ContentVersions in batches of 200 document IDs
 *   3. Download all versions concurrently (default: 10 at a time)
 *   4. Pack into ZIP: Documents/{sanitised_filename} + manifest.csv
 *   5. Store ZIP in job store → emit done with download URL
 *
 * Body: {
 *   latestOnly?:    boolean   — download only IsLatest=true (default: false → all versions)
 *   maxConcurrent?: number    — parallel downloads, default 10 (mirrors ThreadPoolExecutor)
 * }
 */

import JSZip from 'jszip'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { generateJobId, storeResult } from '@/lib/jobs/store'
import { rowsToCSV } from '@/lib/files/csv'
import { createContentDocStats } from '@/lib/models'
import { formatRuntime, makeTimestamp } from '@/lib/config'

// ── Filename helpers ──────────────────────────────────────────────────────────

/** Mirrors _sanitize_filename() in content_document_exporter.py */
function sanitizeFilename(name) {
  return String(name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 200)
    .trim()
}

/**
 * Build the file's on-disk name.
 * Mirrors: f"{title}_{document_id}_v{version_number}.{file_extension}"
 */
function buildFilename(title, docId, versionNumber, fileExtension) {
  const base = `${title}_${docId}_v${versionNumber}`
  return sanitizeFilename(fileExtension ? `${base}.${fileExtension}` : base)
}

// ── Salesforce queries ────────────────────────────────────────────────────────

/**
 * Query ALL ContentDocuments with all fields needed for the CSV manifest.
 * Mirrors _query_content_documents() in content_document_exporter.py.
 */
async function queryContentDocuments(client) {
  const soql = `
    SELECT Id, Title, FileExtension, FileType, ContentSize,
           CreatedDate, LastModifiedDate, OwnerId, ParentId,
           IsArchived, Description, PublishStatus,
           LatestPublishedVersionId
    FROM ContentDocument
    ORDER BY CreatedDate DESC
  `
  const { records } = await client.queryAll(soql)
  return records
}

/**
 * Query ContentVersions for a list of document IDs.
 * Chunks into groups of 200 to stay within SOQL IN-clause limits.
 * Mirrors _query_all_versions() but batched for efficiency.
 *
 * @param {boolean} latestOnly — true = only IsLatest versions
 */
async function queryVersions(client, docIds, latestOnly) {
  const CHUNK = 200
  const all   = []

  for (let i = 0; i < docIds.length; i += CHUNK) {
    const chunk    = docIds.slice(i, i + CHUNK)
    const inClause = chunk.map(id => `'${id}'`).join(', ')
    const latestFilter = latestOnly ? ' AND IsLatest = true' : ''

    const soql = `
      SELECT Id, ContentDocumentId, VersionNumber, IsLatest,
             FileExtension, ContentSize, VersionData,
             CreatedDate, LastModifiedDate
      FROM ContentVersion
      WHERE ContentDocumentId IN (${inClause})${latestFilter}
      ORDER BY ContentDocumentId, VersionNumber ASC
    `
    const { records } = await client.queryAll(soql)
    all.push(...records)
  }

  return all
}

// ── Concurrent download pool ──────────────────────────────────────────────────

/**
 * Run `processItem` on every item in `items`, at most `maxConcurrent` at a time.
 * Mirrors Python's ThreadPoolExecutor(max_workers=10) pattern exactly.
 * JavaScript is single-threaded so there are no race conditions on queue.shift().
 */
async function downloadWithConcurrency(items, processItem, maxConcurrent = 10) {
  if (!items.length) return []

  const queue   = [...items]
  const results = []

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) break
      results.push(await processItem(item))
    }
  }

  const workerCount = Math.min(maxConcurrent, items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

/**
 * Download a single ContentVersion binary with retry.
 * The VersionData field from SOQL is a URL path like
 *   /services/data/v64.0/sobjects/ContentVersion/{Id}/VersionData
 * We fetch it with the stored access token.
 *
 * Mirrors requests.get(download_url, headers=self.headers) with a 120s timeout.
 */
async function downloadVersionFile(client, version, maxAttempts = 3) {
  const url = `${client.instanceUrl}${version.VersionData}`

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
        signal:  AbortSignal.timeout(120_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} from Salesforce`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (attempt === maxAttempts) throw err
      // Exponential back-off: 1s, 2s
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
}

// ── CSV manifest ──────────────────────────────────────────────────────────────

// Column headers — DataLoader-compatible, matches Python exactly
const CSV_HEADERS = [
  'Title',
  'PathOnClient',
  'ContentDocumentId',
  'FirstPublishLocationId',
  'Description',
  'Origin',
  'VersionNumber',
  'IsLatestVersion',
  'Total_Versions_Available',
  'FileExtension',
  'FileType',
  'ContentSize (Bytes)',
  'CreatedDate',
  'LastModifiedDate',
  'OwnerId',
  'DownloadStatus',
  'FailureReason',
]

function buildManifestCSV(versionRows) {
  const rows = versionRows.map(r => [
    r.docTitle,
    r.pathOnClient,
    r.docId,
    '',                    // FirstPublishLocationId — user fills in for DataLoader re-import
    r.docDescription || '',
    'H',                   // Origin 'H' = uploaded file (matches Python)
    String(r.versionNumber),
    r.isLatest ? 'TRUE' : 'FALSE',
    String(r.totalVersions),
    r.fileExtension || '',
    r.fileType || '',
    String(r.contentSize || 0),
    r.createdDate || '',
    r.lastModifiedDate || '',
    r.ownerId || '',
    r.success ? 'Success' : 'Failed',
    r.error || '',
  ])
  return rowsToCSV(CSV_HEADERS, rows)
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  const {
    latestOnly    = false,
    maxConcurrent = 10,
  } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const jobId   = generateJobId()
      const startMs = Date.now()
      const stats   = createContentDocStats()

      // ── Step 1: Query ContentDocuments ──────────────────────────────────
      emit.info('=== ContentDocument File Downloader ===')
      emit.info(`Mode: ${latestOnly ? 'Latest version only' : 'All versions'} | Concurrency: ${maxConcurrent}`)
      emit.info('Querying ContentDocument records…')

      const docs = await queryContentDocuments(client)
      stats.totalDocuments = docs.length

      if (docs.length === 0) {
        emit.warn('No ContentDocuments found in this org.')
        // Store empty zip with empty CSV
        const zip = new JSZip()
        zip.file('manifest.csv', rowsToCSV(CSV_HEADERS, []))
        const buf = await zip.generateAsync({ type: 'nodebuffer' })
        const jid = generateJobId()
        storeResult(jid, { buffer: buf, filename: `ContentDocument_Export_${makeTimestamp()}.zip`, contentType: 'application/zip' })
        emit.done(`/api/content/download/${jid}`, stats)
        return
      }

      emit.success(`Found ${docs.length} ContentDocument record(s)`)

      // Build doc lookup map
      const docMap = new Map(docs.map(d => [d.Id, d]))

      // ── Step 2: Query ContentVersions ───────────────────────────────────
      emit.info(`Fetching ${latestOnly ? 'latest' : 'all'} versions…`)
      emit.progress(5, 'Querying versions…')

      const versions = await queryVersions(client, docs.map(d => d.Id), latestOnly)
      stats.totalVersions = versions.length
      emit.success(`Found ${versions.length} version(s) to download`)

      // Count total versions per document (for CSV column)
      const totalVersionsByDoc = new Map()
      for (const v of versions) {
        totalVersionsByDoc.set(v.ContentDocumentId, (totalVersionsByDoc.get(v.ContentDocumentId) || 0) + 1)
      }

      // ── Step 3: Concurrent downloads ─────────────────────────────────────
      emit.info(`Starting ${maxConcurrent}-concurrent downloads…`)

      const zip          = new JSZip()
      const docsFolder   = zip.folder('Documents')
      const manifestRows = []
      let   dlCount      = 0  // completed (success + fail)

      await downloadWithConcurrency(versions, async (version) => {
        const doc          = docMap.get(version.ContentDocumentId)
        const title        = doc?.Title        || 'Unknown'
        const fileExt      = doc?.FileExtension || version.FileExtension || ''
        const fileType     = doc?.FileType      || ''
        const filename     = buildFilename(title, version.ContentDocumentId, version.VersionNumber, fileExt)
        const totalVers    = totalVersionsByDoc.get(version.ContentDocumentId) || 1
        const pathOnClient = `Documents/${filename}`

        dlCount++
        const pct = Math.round((dlCount / versions.length) * 85) + 5

        emit.progress(pct, `[${dlCount}/${versions.length}] ${filename}`, (Date.now() - startMs) / 1000)

        try {
          const buffer = await downloadVersionFile(client, version)

          docsFolder.file(filename, buffer)
          stats.totalSizeBytes      += buffer.byteLength
          stats.successfulDownloads++

          emit.info(`  ✓ ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KB)`)

          manifestRows.push({
            docTitle: title, pathOnClient,
            docId: version.ContentDocumentId, docDescription: doc?.Description || '',
            versionNumber: version.VersionNumber, isLatest: version.IsLatest,
            totalVersions: totalVers, fileExtension: fileExt, fileType,
            contentSize: version.ContentSize, createdDate: version.CreatedDate,
            lastModifiedDate: version.LastModifiedDate, ownerId: doc?.OwnerId || '',
            success: true,
          })
        } catch (err) {
          stats.failedDownloads++
          stats.failedFiles.push({ id: version.ContentDocumentId, filename, version: version.VersionNumber, reason: err.message })

          emit.error(`  ✗ ${filename}: ${err.message}`)

          manifestRows.push({
            docTitle: title, pathOnClient,
            docId: version.ContentDocumentId, docDescription: doc?.Description || '',
            versionNumber: version.VersionNumber, isLatest: version.IsLatest,
            totalVersions: totalVers, fileExtension: fileExt, fileType,
            contentSize: version.ContentSize, createdDate: version.CreatedDate,
            lastModifiedDate: version.LastModifiedDate, ownerId: doc?.OwnerId || '',
            success: false, error: err.message,
          })
        }
      }, maxConcurrent)

      // ── Step 4: Build CSV manifest + ZIP ─────────────────────────────────
      emit.progress(92, 'Building CSV manifest…')
      zip.file('manifest.csv', buildManifestCSV(manifestRows))

      emit.progress(95, 'Generating ZIP archive…')

      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)

      const zipBuffer = await zip.generateAsync({
        type:               'nodebuffer',
        compression:        'DEFLATE',
        compressionOptions: { level: 6 },
      })

      storeResult(jobId, {
        buffer:      zipBuffer,
        filename:    `ContentDocument_Export_${makeTimestamp()}.zip`,
        contentType: 'application/zip',
      })

      emit.done(`/api/content/download/${jobId}`, stats)
      emit.success(
        `=== Done in ${stats.runtimeFormatted} — ` +
        `${stats.successfulDownloads} downloaded, ${stats.failedDownloads} failed, ` +
        `${(stats.totalSizeBytes / 1024 / 1024).toFixed(1)} MB ===`
      )

    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') {
        emit.error('Session expired. Please reconnect to Salesforce.')
      } else {
        emit.error(`Export failed: ${err.message}`)
      }
    } finally {
      end()
    }
  })()

  return response
}

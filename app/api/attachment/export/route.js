// FILE PATH: app/api/attachment/export/route.js
/**
 * POST /api/attachment/export
 *
 * Downloads Salesforce legacy Attachment records (the classic pre-ContentDocument
 * attachment model). Attachments are stored directly on parent records (Accounts,
 * Cases, Contacts, etc.) and have been superseded by ContentDocument/ContentVersion
 * in modern Salesforce orgs — but many orgs still carry years of legacy attachments.
 *
 * Flow:
 *   1. Query all Attachment records (paginated) with full metadata
 *   2. Download each Attachment.Body blob via the REST API
 *   3. Pack into ZIP:
 *        Attachments/{AttachmentId}_{Name}   — the actual files
 *        attachment_manifest.csv             — DataLoader-compatible CSV
 *   4. Base64-encode the ZIP and emit it directly in the SSE done event
 *      (same inline-delivery pattern as /api/content/export — avoids
 *       Vercel multi-instance job-store misses)
 *
 * attachment_manifest.csv columns (industry-standard for SF Attachment migration):
 *   Id | Name | ParentId | ParentType | ParentName
 *   ContentType | BodyLength (Bytes) | IsPrivate
 *   Description | OwnerId | OwnerName
 *   CreatedById | CreatedDate | LastModifiedById | LastModifiedDate
 *   PathInZip | DownloadStatus | FailureReason
 *
 * Body: {
 *   maxConcurrent?: number  — parallel downloads, default 10
 * }
 */

import JSZip from 'jszip'
import { getSession }            from '@/lib/session'
import { SalesforceClient }      from '@/lib/salesforce/client'
import { createSSEStream }       from '@/lib/streaming/sse'
import { rowsToCSV }             from '@/lib/files/csv'
import { createAttachmentStats } from '@/lib/models'
import { formatRuntime, makeTimestamp } from '@/lib/config'
import { checkRateLimit, rateLimitResponse, EXPORT_LIMIT } from '@/lib/rateLimit'

// ── Filename helpers ──────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return String(name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 200)
    .trim()
}

/**
 * Build a unique filename for an Attachment.
 * Format: {AttachmentId}_{Name}
 * Using the Id prefix guarantees uniqueness even when two attachments
 * on different parents share the same Name.
 */
function buildAttachmentFilename(attachmentId, name) {
  const safe     = sanitizeFilename(name)
  const dotIndex = safe.lastIndexOf('.')
  const hasExt   = dotIndex > 0 && dotIndex < safe.length - 1
  const base     = hasExt ? safe.slice(0, dotIndex) : safe
  const ext      = hasExt ? safe.slice(dotIndex)    : ''  // e.g. ".pdf"
  return `${base}_${attachmentId}${ext}`
}

// ── Salesforce queries ────────────────────────────────────────────────────────

/**
 * Query all Attachment records with full metadata.
 *
 * We fetch Parent.Type and Parent.Name via the relationship traversal.
 * If the org has restricted visibility on certain parent types (e.g. deleted
 * parents), those rows still appear but with null parent info — handled below.
 *
 * BodyLength is returned in bytes. The actual Body blob is fetched separately
 * via the REST /sobjects/Attachment/{Id}/Body endpoint.
 */
async function queryAttachments(client) {
  const soql = `
    SELECT
      Id,
      Name,
      ParentId,
      Parent.Type,
      Parent.Name,
      ContentType,
      BodyLength,
      IsPrivate,
      Description,
      OwnerId,
      Owner.Name,
      CreatedById,
      CreatedDate,
      LastModifiedById,
      LastModifiedDate
    FROM Attachment
    ORDER BY CreatedDate DESC
  `
  const { records, totalSize } = await client.queryAll(soql)
  return { records, totalSize }
}

// ── Concurrent download pool ──────────────────────────────────────────────────

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
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, worker))
  return results
}

/**
 * Download the binary body of a single Attachment.
 *
 * The actual bytes are served at:
 *   /services/data/v{ver}/sobjects/Attachment/{Id}/Body
 *
 * Retries up to maxAttempts times with linear back-off on transient errors.
 */
async function downloadAttachmentBody(client, attachmentId, maxAttempts = 3) {
  const url = `${client.instanceUrl}/services/data/v${client.apiVersion}/sobjects/Attachment/${attachmentId}/Body`
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
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
}

// ── CSV manifest ──────────────────────────────────────────────────────────────

/**
 * Industry-standard columns for Salesforce Attachment migration/audit CSVs.
 *
 * Column rationale:
 *   Id, Name           — primary identifiers; Id is the 15/18-char SF record ID
 *   ParentId           — the record this attachment belongs to (DataLoader FK)
 *   ParentType         — object API name of the parent (e.g. Account, Case)
 *   ParentName         — human-readable parent record name for triage
 *   ContentType        — MIME type (e.g. application/pdf, image/jpeg)
 *   BodyLength (Bytes) — file size; helps identify oversized attachments
 *   IsPrivate          — private attachments visible only to owner and admins
 *   Description        — optional metadata set by the uploader
 *   OwnerId            — SF user ID of the record owner
 *   OwnerName          — human-readable owner name for triage
 *   CreatedById        — user who originally uploaded the attachment
 *   CreatedDate        — upload timestamp; useful for retention/archival policies
 *   LastModifiedById   — last modifier
 *   LastModifiedDate   — last modified timestamp
 *   PathInZip          — exact path inside the ZIP for re-import scripting
 *   DownloadStatus     — Success | Failed
 *   FailureReason      — error detail when DownloadStatus = Failed
 */
const ATTACHMENT_CSV_HEADERS = [
  'Id',
  'Name',
  'ParentId',
  'ParentType',
  'ParentName',
  'ContentType',
  'BodyLength (Bytes)',
  'IsPrivate',
  'Description',
  'OwnerId',
  'OwnerName',
  'CreatedById',
  'CreatedDate',
  'LastModifiedById',
  'LastModifiedDate',
  'PathInZip',
  'DownloadStatus',
  'FailureReason',
]

function buildAttachmentManifestCSV(rows) {
  const csvRows = rows.map(r => [
    r.id,
    r.name,
    r.parentId          || '',
    r.parentType        || '',
    r.parentName        || '',
    r.contentType       || '',
    String(r.bodyLength || 0),
    r.isPrivate ? 'TRUE' : 'FALSE',
    r.description       || '',
    r.ownerId           || '',
    r.ownerName         || '',
    r.createdById       || '',
    r.createdDate       || '',
    r.lastModifiedById  || '',
    r.lastModifiedDate  || '',
    r.pathInZip         || '',
    r.success ? 'Success' : 'Failed',
    r.error             || '',
  ])
  return rowsToCSV(ATTACHMENT_CSV_HEADERS, csvRows)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  const {
    maxConcurrent = 10,
  } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rl = checkRateLimit(`${session.instanceUrl}:attachment`, EXPORT_LIMIT)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const startMs = Date.now()
      const stats   = createAttachmentStats()

      // ── Step 1: Query all Attachments ─────────────────────────────────
      emit.info('=== Legacy Attachment Downloader ===')
      emit.info(`Concurrency: ${maxConcurrent}`)
      emit.info('Querying Attachment records…')
      emit.progress(3, 'Querying Attachment records…')

      let records
      try {
        ;({ records } = await queryAttachments(client))
      } catch (err) {
        if (/insufficient access|INSUFFICIENT_ACCESS/i.test(err.message)) {
          emit.error(
            'Insufficient permissions to query Attachment records. ' +
            'Ensure your profile has "Read" access on the Attachment object.'
          )
        } else {
          throw err
        }
        return
      }

      stats.totalAttachments = records.length

      if (records.length === 0) {
        emit.warn('No Attachment records found in this org.')
        const zip      = new JSZip()
        zip.file('attachment_manifest.csv', rowsToCSV(ATTACHMENT_CSV_HEADERS, []))
        const buf      = await zip.generateAsync({ type: 'nodebuffer' })
        const filename = `Attachment_Export_${makeTimestamp()}.zip`
        emit.data({ type: 'done', zipBase64: buf.toString('base64'), filename, stats })
        return
      }

      emit.success(`Found ${records.length.toLocaleString()} Attachment record(s)`)
      emit.progress(8, 'Preparing downloads…')

      // ── Step 2: Concurrent body downloads ─────────────────────────────
      emit.info(`Starting ${maxConcurrent}-concurrent downloads…`)

      const zip               = new JSZip()
      const attachmentsFolder = zip.folder('Attachments')
      const manifestRows      = []
      let   dlCount           = 0

      await downloadWithConcurrency(records, async (attachment) => {
        const filename  = buildAttachmentFilename(attachment.Id, attachment.Name)
        const pathInZip = `Attachments/${filename}`

        dlCount++
        const pct = Math.round((dlCount / records.length) * 84) + 10
        emit.progress(
          pct,
          `[${dlCount}/${records.length}] ${filename}`,
          (Date.now() - startMs) / 1000,
        )

        // Resolve relationship fields (may be null if parent is deleted/restricted)
        const parentType = attachment.Parent?.Type || ''
        const parentName = attachment.Parent?.Name || ''
        const ownerName  = attachment.Owner?.Name  || ''

        try {
          const buffer = await downloadAttachmentBody(client, attachment.Id)

          attachmentsFolder.file(filename, buffer)
          stats.totalSizeBytes      += buffer.byteLength
          stats.successfulDownloads++

          const sizeKb = (buffer.byteLength / 1024).toFixed(1)
          emit.info(
            `  ✓ ${filename} (${sizeKb} KB)` +
            (parentName ? ` — ${parentType}: ${parentName}` : '')
          )

          manifestRows.push({
            id: attachment.Id, name: attachment.Name,
            parentId: attachment.ParentId, parentType, parentName,
            contentType: attachment.ContentType, bodyLength: attachment.BodyLength,
            isPrivate: attachment.IsPrivate, description: attachment.Description,
            ownerId: attachment.OwnerId, ownerName,
            createdById: attachment.CreatedById, createdDate: attachment.CreatedDate,
            lastModifiedById: attachment.LastModifiedById, lastModifiedDate: attachment.LastModifiedDate,
            pathInZip, success: true,
          })
        } catch (err) {
          stats.failedDownloads++
          stats.failedFiles.push({ id: attachment.Id, filename, reason: err.message })
          emit.error(`  ✗ ${filename}: ${err.message}`)

          manifestRows.push({
            id: attachment.Id, name: attachment.Name,
            parentId: attachment.ParentId, parentType, parentName,
            contentType: attachment.ContentType, bodyLength: attachment.BodyLength,
            isPrivate: attachment.IsPrivate, description: attachment.Description,
            ownerId: attachment.OwnerId, ownerName,
            createdById: attachment.CreatedById, createdDate: attachment.CreatedDate,
            lastModifiedById: attachment.LastModifiedById, lastModifiedDate: attachment.LastModifiedDate,
            pathInZip, success: false, error: err.message,
          })
        }
      }, maxConcurrent)

      // ── Step 3: Build manifest CSV + ZIP ──────────────────────────────
      emit.progress(95, 'Building attachment_manifest.csv…')
      zip.file('attachment_manifest.csv', buildAttachmentManifestCSV(manifestRows))

      emit.progress(98, 'Generating ZIP archive…')

      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)

      const zipBuffer = await zip.generateAsync({
        type:               'nodebuffer',
        compression:        'DEFLATE',
        compressionOptions: { level: 6 },
      })

      const zipBase64 = zipBuffer.toString('base64')
      const filename  = `Attachment_Export_${makeTimestamp()}.zip`

      emit.data({ type: 'done', zipBase64, filename, stats })
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
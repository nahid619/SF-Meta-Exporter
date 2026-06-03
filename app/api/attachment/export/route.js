// FILE PATH: app/api/attachment/export/route.js
/**
 * POST /api/attachment/export
 *
 * Downloads Salesforce legacy Attachment records filtered by parent object type.
 * Since an Attachment always belongs to exactly one parent record, we can filter
 * precisely by querying WHERE Parent.Type IN (...selectedObjects).
 *
 * Flow:
 *   1. For each selected object type — query its Attachments, download bodies,
 *      emit per-object SSE progress events
 *   2. All files packed into one ZIP:
 *        Attachments/{Name}_{Id}.{ext}   — the actual files
 *        attachment_manifest.csv         — DataLoader-compatible CSV
 *   3. Base64-encode the ZIP and emit it directly in the SSE done event
 *
 * attachment_manifest.csv columns:
 *   Id | Name | ParentId | ParentType | ParentName
 *   ContentType | BodyLength (Bytes) | IsPrivate
 *   Description | OwnerId | OwnerName
 *   CreatedById | CreatedDate | LastModifiedById | LastModifiedDate
 *   PathInZip | DownloadStatus | FailureReason
 *
 * Body: {
 *   objects:       string[]  — parent object API names to filter by (e.g. ['Account','Case'])
 *   maxConcurrent?: number   — parallel downloads per object, default 10
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
 * {Name}_{Id}.{ext}
 * Extension is pulled from the sanitized name — guaranteed to be last.
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
 * Query Attachments for a single parent object type.
 * Parent.Type is the object API name (e.g. "Account").
 * We query one object at a time so we can emit per-object SSE progress.
 */
async function queryAttachmentsForObject(client, objectType) {
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
    WHERE Parent.Type = '${objectType}'
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
 * Download the binary body of a single Attachment via:
 *   /services/data/v{ver}/sobjects/Attachment/{Id}/Body
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
    objects       = [],
    maxConcurrent = 10,
  } = await request.json()

  if (!objects.length) {
    return Response.json({ error: 'No objects selected.' }, { status: 400 })
  }

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

      // objectResults drives the per-object progress cards in the UI
      stats.objectResults = objects.map(name => ({
        objectName:   name,
        found:        null,   // null = not queried yet
        downloaded:   0,
        failed:       0,
        sizeMb:       '0.0',
        done:         false,
      }))

      emit.info('=== Legacy Attachment Downloader ===')
      emit.info(`Objects: ${objects.join(', ')} | Concurrency: ${maxConcurrent}`)

      const zip               = new JSZip()
      const attachmentsFolder = zip.folder('Attachments')
      const allManifestRows   = []

      // ── Process each object type in sequence ──────────────────────────
      for (let objIdx = 0; objIdx < objects.length; objIdx++) {
        const objectType = objects[objIdx]
        const objResult  = stats.objectResults[objIdx]

        emit.info(`── ${objectType} ──`)
        emit.info(`Querying Attachment records where Parent.Type = '${objectType}'…`)

        const overallPctBase = Math.round((objIdx / objects.length) * 90)

        // Query
        let records
        try {
          ;({ records } = await queryAttachmentsForObject(client, objectType))
        } catch (err) {
          if (/insufficient access|INSUFFICIENT_ACCESS/i.test(err.message)) {
            emit.error(`  ${objectType}: Insufficient permissions to query Attachments.`)
          } else {
            emit.error(`  ${objectType}: Query failed — ${err.message}`)
          }
          objResult.done  = true
          objResult.found = 0
          stats.objectResults = [...stats.objectResults]
          emit.data({ type: 'stats', stats: { ...stats } })
          continue
        }

        objResult.found        = records.length
        stats.totalAttachments += records.length
        emit.data({ type: 'stats', stats: { ...stats } })

        if (records.length === 0) {
          emit.warn(`  ${objectType}: No Attachments found.`)
          objResult.done = true
          emit.data({ type: 'stats', stats: { ...stats } })
          continue
        }

        emit.success(`  ${objectType}: Found ${records.length} Attachment(s)`)

        // Download
        let objSizeBytes = 0
        let dlCount      = 0

        await downloadWithConcurrency(records, async (attachment) => {
          const filename  = buildAttachmentFilename(attachment.Id, attachment.Name)
          const pathInZip = `Attachments/${filename}`

          dlCount++
          const withinObjPct = Math.round((dlCount / records.length) * (90 / objects.length))
          const pct = overallPctBase + withinObjPct
          emit.progress(
            pct,
            `[${objectType}] [${dlCount}/${records.length}] ${filename}`,
            (Date.now() - startMs) / 1000,
          )

          const parentType = attachment.Parent?.Type || objectType
          const parentName = attachment.Parent?.Name || ''
          const ownerName  = attachment.Owner?.Name  || ''

          try {
            const buffer = await downloadAttachmentBody(client, attachment.Id)

            attachmentsFolder.file(filename, buffer)
            objSizeBytes              += buffer.byteLength
            stats.totalSizeBytes      += buffer.byteLength
            stats.successfulDownloads++
            objResult.downloaded++
            objResult.sizeMb = (objSizeBytes / 1024 / 1024).toFixed(1)

            emit.info(
              `  ✓ ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KB)` +
              (parentName ? ` — ${parentName}` : '')
            )

            allManifestRows.push({
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
            objResult.failed++
            stats.failedFiles.push({ id: attachment.Id, filename, reason: err.message })
            emit.error(`  ✗ ${filename}: ${err.message}`)

            allManifestRows.push({
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

          // Push updated stats after every download so the UI cards update live
          emit.data({ type: 'stats', stats: { ...stats } })
        }, maxConcurrent)

        objResult.done   = true
        objResult.sizeMb = (objSizeBytes / 1024 / 1024).toFixed(1)
        emit.success(
          `  ${objectType}: ${objResult.downloaded} downloaded` +
          (objResult.failed > 0 ? `, ${objResult.failed} failed` : '') +
          ` — ${objResult.sizeMb} MB`
        )
        emit.data({ type: 'stats', stats: { ...stats } })
      }

      // ── Build manifest + ZIP ──────────────────────────────────────────
      emit.progress(95, 'Building attachment_manifest.csv…')
      zip.file('attachment_manifest.csv', buildAttachmentManifestCSV(allManifestRows))

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
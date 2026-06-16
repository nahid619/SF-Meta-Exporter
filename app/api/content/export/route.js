// FILE PATH: app/api/content/export/route.js
/**
 * POST /api/content/export
 *
 * Flow:
 *   1. (Optional) Resolve object-type restriction: for each selected object
 *      API name, semi-join ContentDocumentLink → SObject.Id to get the set
 *      of ContentDocumentIds linked to that object, then union the sets.
 *   2. Query all ContentDocuments (paginated), applying caller-supplied
 *      field filters AND the object-type restriction (Id IN batches of 400)
 *   3. Query ContentVersions in batches of 200 document IDs
 *   4. Query ContentDocumentLink — resolves which SF object/record each file
 *      is attached to. A file can link to multiple records, so values are
 *      pipe-separated in the CSV columns.
 *   5. Download all versions concurrently (default: 10 at a time)
 *   6. Pack into ZIP:
 *        Files/{sanitised_filename}   — the actual files
 *        file_manifest.csv            — RFC 4180 CSV, opens cleanly in Excel
 *   7. Base64-encode the ZIP and emit it directly in the SSE done event
 *      (avoids Vercel multi-instance job-store miss on the download request)
 *
 * file_manifest.csv columns (new columns marked ★):
 *   Title | PathOnClient | ContentDocumentId
 *   ★ LinkedObjectNames | ★ LinkedRecordIds | ★ LinkedRecordCount
 *   FirstPublishLocationId | Description | Origin
 *   VersionNumber | IsLatestVersion | Total_Versions_Available
 *   FileExtension | FileType | ContentSize (Bytes)
 *   CreatedDate | LastModifiedDate | OwnerId
 *   DownloadStatus | FailureReason
 *
 * Body: {
 *   latestOnly?:    boolean  — download only IsLatest=true (default: false)
 *   maxConcurrent?: number   — parallel downloads, default 10
 *   objectTypes?:   string[] — only download files linked to a record of one
 *                              of these SObjects, e.g. ['Account', 'Case'].
 *                              Resolved via a ContentDocumentLink semi-join
 *                              since ContentDocument has no Parent/Type field.
 *   filters?: {
 *     created_from?:   string  — YYYY-MM-DD, maps to CreatedDate >=
 *     created_to?:     string  — YYYY-MM-DD, maps to CreatedDate <=
 *     modified_from?:  string  — YYYY-MM-DD, maps to LastModifiedDate >=
 *     modified_to?:    string  — YYYY-MM-DD, maps to LastModifiedDate <=
 *     file_type?:      string  — partial match on FileType   (LIKE '%…%')
 *     file_extension?: string  — partial match on FileExtension (LIKE '%…%')
 *     title?:          string  — partial match on Title      (LIKE '%…%')
 *     is_archived?:    'true' | 'false'  — IsArchived = true/false
 *   }
 * }
 */

import JSZip from 'jszip'
import { getSession }            from '@/lib/session'
import { SalesforceClient }      from '@/lib/salesforce/client'
import { createSSEStream }       from '@/lib/streaming/sse'
import { rowsToCSV }             from '@/lib/files/csv'
import { createContentDocStats } from '@/lib/models'
import { formatRuntime, makeTimestamp } from '@/lib/config'
import { checkRateLimit, rateLimitResponse, EXPORT_LIMIT } from '@/lib/rateLimit'

// ── Filename helpers ──────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return String(name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 200)
    .trim()
}

function buildFilename(title, docId, versionNumber, fileExtension) {
  const base = `${title}_${docId}_v${versionNumber}`
  return sanitizeFilename(fileExtension ? `${base}.${fileExtension}` : base)
}

// ── SOQL filter / WHERE-clause builder ───────────────────────────────────────

/**
 * Escape a value for use inside a SOQL single-quoted string literal.
 * Prevents injection via text filter fields.
 */
function escapeSoqlString(value) {
  return String(value).replace(/'/g, "\\'")
}

/**
 * Convert a YYYY-MM-DD date string to a Salesforce datetime literal.
 *   'start' → 2024-01-15T00:00:00Z
 *   'end'   → 2024-01-15T23:59:59Z
 */
function toSfDatetime(dateStr, boundary) {
  const time = boundary === 'end' ? '23:59:59' : '00:00:00'
  return `${dateStr}T${time}Z`
}

/**
 * Build the WHERE clause string from a filters object.
 * Returns an empty string when no filters are set.
 *
 * Mirrors Python's ContentDocumentExporter._build_where_clause().
 */
function buildWhereClause(filters = {}) {
  const conditions = []

  if (filters.created_from) {
    conditions.push(`CreatedDate >= ${toSfDatetime(filters.created_from, 'start')}`)
  }
  if (filters.created_to) {
    conditions.push(`CreatedDate <= ${toSfDatetime(filters.created_to, 'end')}`)
  }
  if (filters.modified_from) {
    conditions.push(`LastModifiedDate >= ${toSfDatetime(filters.modified_from, 'start')}`)
  }
  if (filters.modified_to) {
    conditions.push(`LastModifiedDate <= ${toSfDatetime(filters.modified_to, 'end')}`)
  }
  if (filters.file_type) {
    conditions.push(`FileType LIKE '%${escapeSoqlString(filters.file_type)}%'`)
  }
  if (filters.file_extension) {
    conditions.push(`FileExtension LIKE '%${escapeSoqlString(filters.file_extension)}%'`)
  }
  if (filters.title) {
    conditions.push(`Title LIKE '%${escapeSoqlString(filters.title)}%'`)
  }
  if (filters.is_archived === 'true' || filters.is_archived === 'false') {
    conditions.push(`IsArchived = ${filters.is_archived}`)
  }

  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
}

// ── Salesforce queries ────────────────────────────────────────────────────────

// Max ContentDocument Ids per "Id IN (...)" SOQL clause — keeps the query
// string comfortably under Salesforce's 20,000-character SOQL limit, even
// combined with the other field filters (date ranges, LIKE clauses, etc.).
const ID_CHUNK_SIZE = 400

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** Combine an existing 'WHERE ...' clause (or '') with one more bare condition. */
function combineWhere(baseWhere, extraCondition) {
  return baseWhere ? `${baseWhere} AND ${extraCondition}` : `WHERE ${extraCondition}`
}

function buildContentDocumentQuery(whereClause) {
  return `
    SELECT Id, Title, FileExtension, FileType, ContentSize,
           CreatedDate, LastModifiedDate, OwnerId, ParentId,
           IsArchived, Description, PublishStatus,
           LatestPublishedVersionId
    FROM ContentDocument
    ${whereClause}
    ORDER BY CreatedDate DESC
  `
}

/**
 * Resolve the ContentDocumentIds linked to any record of `objectType`.
 *
 * Salesforce Files don't carry a Parent/Type field the way legacy
 * Attachments do — the link lives on ContentDocumentLink.LinkedEntityId,
 * a polymorphic field that can't be filtered by LinkedEntity.Type directly.
 * The standard workaround is a semi-join scoping LinkedEntityId to the
 * target object's own Id space:
 *
 *   SELECT ContentDocumentId FROM ContentDocumentLink
 *   WHERE LinkedEntityId IN (SELECT Id FROM {objectType})
 */
async function queryLinkedDocumentIds(client, objectType) {
  // objectType is expected to come from the org's own describeGlobal() list
  // (see /api/objects), but since it's interpolated directly into the FROM
  // clause — not a quoted literal — we still validate its shape defensively.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(objectType)) {
    console.warn('[content/export] Skipping invalid object type:', objectType)
    return new Set()
  }
  try {
    const soql = `
      SELECT ContentDocumentId
      FROM ContentDocumentLink
      WHERE LinkedEntityId IN (SELECT Id FROM ${objectType})
    `
    const { records } = await client.queryAll(soql)
    return new Set(records.map(r => r.ContentDocumentId))
  } catch (err) {
    console.warn(`[content/export] ContentDocumentLink query failed for ${objectType}:`, err.message)
    return new Set()
  }
}

/**
 * Query ContentDocument records, optionally narrowed by field filters and/or
 * restricted to a specific set of Ids (the linked-object filter resolves to
 * this set before this function ever runs).
 */
async function queryContentDocuments(client, filters = {}, restrictToIds = null) {
  // An empty (but non-null) restriction means the object filter matched
  // nothing — short-circuit instead of issuing a query that would also
  // return nothing.
  if (restrictToIds !== null && restrictToIds.size === 0) return []

  const baseWhere = buildWhereClause(filters)

  if (!restrictToIds) {
    const soql = buildContentDocumentQuery(baseWhere)
    const { records } = await client.queryAll(soql)
    return records
  }

  // Batch the Id list so each "Id IN (...)" clause stays well under
  // Salesforce's SOQL length limit, then merge the batched results.
  const allRecords = []
  for (const batch of chunkArray([...restrictToIds].sort(), ID_CHUNK_SIZE)) {
    const idClause    = `Id IN (${batch.map(id => `'${id}'`).join(',')})`
    const whereClause = combineWhere(baseWhere, idClause)
    const soql        = buildContentDocumentQuery(whereClause)
    const { records } = await client.queryAll(soql)
    allRecords.push(...records)
  }
  return allRecords
}

async function queryVersions(client, docIds, latestOnly) {
  const CHUNK = 200
  const all   = []

  for (let i = 0; i < docIds.length; i += CHUNK) {
    const chunk      = docIds.slice(i, i + CHUNK)
    const inClause   = chunk.map(id => `'${id}'`).join(', ')
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

/**
 * Query ContentDocumentLink for all doc IDs.
 * Returns Map<docId, [ { objectName, recordId }, … ]>
 */
async function queryLinkedObjects(client, docIds) {
  const CHUNK   = 200
  const linkMap = new Map()
  for (const id of docIds) linkMap.set(id, [])

  for (let i = 0; i < docIds.length; i += CHUNK) {
    const chunk    = docIds.slice(i, i + CHUNK)
    const inClause = chunk.map(id => `'${id}'`).join(', ')

    const soql = `
      SELECT ContentDocumentId,
             LinkedEntityId,
             LinkedEntity.Type
      FROM ContentDocumentLink
      WHERE ContentDocumentId IN (${inClause})
      ORDER BY ContentDocumentId
    `

    try {
      const { records } = await client.queryAll(soql)
      for (const link of records) {
        const docId      = link.ContentDocumentId
        const recordId   = link.LinkedEntityId
        const objectName = link.LinkedEntity?.Type || 'Unknown'
        if (!linkMap.has(docId)) linkMap.set(docId, [])
        linkMap.get(docId).push({ objectName, recordId })
      }
    } catch (err) {
      console.warn('[content/export] ContentDocumentLink query failed:', err.message)
      break
    }
  }

  return linkMap
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
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
}

// ── CSV manifest ──────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'Title',
  'PathOnClient',
  'ContentDocumentId',
  'LinkedObjectNames',
  'LinkedRecordIds',
  'LinkedRecordCount',
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
    r.linkedObjectNames,
    r.linkedRecordIds,
    String(r.linkedRecordCount),
    '',
    r.docDescription || '',
    'H',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable summary of which filters are active — logged in the SSE stream. */
function describeFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) return 'none'
  const parts = []
  if (filters.created_from || filters.created_to) {
    parts.push(`CreatedDate [${filters.created_from || '*'} → ${filters.created_to || '*'}]`)
  }
  if (filters.modified_from || filters.modified_to) {
    parts.push(`LastModifiedDate [${filters.modified_from || '*'} → ${filters.modified_to || '*'}]`)
  }
  if (filters.file_type)      parts.push(`FileType LIKE '%${filters.file_type}%'`)
  if (filters.file_extension) parts.push(`FileExtension LIKE '%${filters.file_extension}%'`)
  if (filters.title)          parts.push(`Title LIKE '%${filters.title}%'`)
  if (filters.is_archived)    parts.push(`IsArchived = ${filters.is_archived}`)
  return parts.join(', ')
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  const {
    latestOnly    = false,
    maxConcurrent = 10,
    filters       = {},
    objectTypes   = [],
  } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rl = checkRateLimit(`${session.instanceUrl}:content`, EXPORT_LIMIT)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const startMs = Date.now()
      const stats   = createContentDocStats()

      // ── Step 1: Resolve object-type restriction (if any) ──────────────
      emit.info('=== ContentDocument File Downloader ===')
      emit.info(`Mode: ${latestOnly ? 'Latest version only' : 'All versions'} | Concurrency: ${maxConcurrent}`)

      const filterDesc = describeFilters(filters)
      emit.info(`Filters: ${filterDesc}`)

      let restrictToIds = null
      if (objectTypes.length > 0) {
        emit.info(`Filtering by linked object type(s): ${objectTypes.join(', ')}`)
        emit.progress(2, 'Resolving object filter…')

        restrictToIds = new Set()
        for (const objType of objectTypes) {
          const linkedIds = await queryLinkedDocumentIds(client, objType)
          emit.info(`  ${objType}: ${linkedIds.size} linked document(s)`)
          for (const id of linkedIds) restrictToIds.add(id)
        }
        stats.objectTypesFiltered = objectTypes
      }

      // ── Step 2: Query ContentDocuments ─────────────────────────────────
      emit.info('Querying ContentDocument records…')

      const docs = await queryContentDocuments(client, filters, restrictToIds)
      stats.totalDocuments = docs.length

      if (docs.length === 0) {
        if (restrictToIds !== null && restrictToIds.size === 0) {
          emit.warn('No documents are linked to the selected object type(s).')
        } else {
          emit.warn('No ContentDocuments found matching the current filters.')
        }
        const zip      = new JSZip()
        zip.file('file_manifest.csv', rowsToCSV(CSV_HEADERS, []))
        const buf      = await zip.generateAsync({ type: 'nodebuffer' })
        const filename = `ContentDocument_Export_${makeTimestamp()}.zip`
        emit.data({ type: 'done', zipBase64: buf.toString('base64'), filename, stats })
        return
      }

      emit.success(`Found ${docs.length} ContentDocument record(s)`)

      const docIds = docs.map(d => d.Id)
      const docMap = new Map(docs.map(d => [d.Id, d]))

      // ── Step 3: Query ContentVersions ─────────────────────────────────
      emit.info(`Fetching ${latestOnly ? 'latest' : 'all'} versions…`)
      emit.progress(5, 'Querying versions…')

      const versions = await queryVersions(client, docIds, latestOnly)
      stats.totalVersions = versions.length
      emit.success(`Found ${versions.length} version(s) to download`)

      const totalVersionsByDoc = new Map()
      for (const v of versions) {
        totalVersionsByDoc.set(v.ContentDocumentId, (totalVersionsByDoc.get(v.ContentDocumentId) || 0) + 1)
      }

      // ── Step 4: Query ContentDocumentLink ─────────────────────────────
      emit.info('Resolving object linkage via ContentDocumentLink…')
      emit.progress(8, 'Querying object links…')

      const linkMap         = await queryLinkedObjects(client, docIds)
      const objectTypesSeen = new Set()
      for (const links of linkMap.values()) {
        for (const { objectName } of links) objectTypesSeen.add(objectName)
      }

      if (objectTypesSeen.size > 0) {
        emit.success(`Object types found: ${[...objectTypesSeen].sort().join(', ')}`)
      } else {
        emit.warn('No ContentDocumentLink records found — LinkedObjectNames will be empty.')
      }

      // ── Step 5: Concurrent downloads ──────────────────────────────────
      emit.info(`Starting ${maxConcurrent}-concurrent downloads…`)

      const zip          = new JSZip()
      const docsFolder   = zip.folder('Files')
      const manifestRows = []
      let   dlCount      = 0

      await downloadWithConcurrency(versions, async (version) => {
        const doc          = docMap.get(version.ContentDocumentId)
        const title        = doc?.Title        || 'Unknown'
        const fileExt      = doc?.FileExtension || version.FileExtension || ''
        const fileType     = doc?.FileType      || ''
        const filename     = buildFilename(title, version.ContentDocumentId, version.VersionNumber, fileExt)
        const totalVers    = totalVersionsByDoc.get(version.ContentDocumentId) || 1
        const pathOnClient = `Files/${filename}`

        const links             = linkMap.get(version.ContentDocumentId) || []
        const linkedObjectNames = links.map(l => l.objectName).join(' | ') || ''
        const linkedRecordIds   = links.map(l => l.recordId).join(' | ')   || ''
        const linkedRecordCount = links.length

        dlCount++
        const pct = Math.round((dlCount / versions.length) * 82) + 10
        emit.progress(pct, `[${dlCount}/${versions.length}] ${filename}`, (Date.now() - startMs) / 1000)

        try {
          const buffer = await downloadVersionFile(client, version)

          docsFolder.file(filename, buffer)
          stats.totalSizeBytes      += buffer.byteLength
          stats.successfulDownloads++

          emit.info(
            `  ✓ ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KB)` +
            (linkedObjectNames ? ` — ${linkedObjectNames}` : '')
          )

          manifestRows.push({
            docTitle: title, pathOnClient,
            docId: version.ContentDocumentId, docDescription: doc?.Description || '',
            linkedObjectNames, linkedRecordIds, linkedRecordCount,
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
            linkedObjectNames, linkedRecordIds, linkedRecordCount,
            versionNumber: version.VersionNumber, isLatest: version.IsLatest,
            totalVersions: totalVers, fileExtension: fileExt, fileType,
            contentSize: version.ContentSize, createdDate: version.CreatedDate,
            lastModifiedDate: version.LastModifiedDate, ownerId: doc?.OwnerId || '',
            success: false, error: err.message,
          })
        }
      }, maxConcurrent)

      // ── Step 6: Build CSV manifest + ZIP ──────────────────────────────
      emit.progress(94, 'Building file_manifest.csv…')
      zip.file('file_manifest.csv', buildManifestCSV(manifestRows))

      emit.progress(97, 'Generating ZIP archive…')

      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)

      const zipBuffer = await zip.generateAsync({
        type:               'nodebuffer',
        compression:        'DEFLATE',
        compressionOptions: { level: 6 },
      })

      const zipBase64 = zipBuffer.toString('base64')
      const filename  = `ContentDocument_Export_${makeTimestamp()}.zip`

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

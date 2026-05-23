// app/api/backup/restore/route.js

/**
 * Increase the body size limit for this route — the restore POST sends all
 * CSV data as JSON, which can exceed Next.js's default 4 MB cap.
 * Note: on Vercel, the platform limit (4.5 MB hobby / higher on Pro) also applies.
 * For very large orgs, consider a streaming multipart upload instead.
 */
export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

/**
 * POST /api/backup/restore
 *
 * Body: {
 *   metadata: object,          — parsed metadata.json from a backup ZIP
 *   csvData:  { [ObjectName]: string }  — raw CSV text per object
 * }
 *
 * Streams SSE progress while:
 *   1. Sorting objects by dependency order (Kahn's algorithm)
 *   2. Describing each object to find its createable fields
 *   3. Parsing the CSV and filtering to only createable columns
 *   4. Batch-inserting records (200 at a time) via the Composite Sobjects API
 *
 * Ported from SFRewind/core/restore_manager.py (RestoreManager.restore_backup +
 * _calculate_import_order + _validate_and_filter_fields + _import_object).
 *
 * NOTE ON REQUEST SIZE:
 *   The CSV strings are sent as JSON in the request body. Next.js defaults to a
 *   4 MB body size limit. For large backups, increase the limit by adding to
 *   next.config.js:
 *     experimental: { serverActions: { bodySizeLimit: '50mb' } }
 *   or wrap the CSV data in a server-streamed multipart upload (future enhancement).
 *   For typical sandboxes (<50k records across all objects) the 4 MB limit is
 *   unlikely to be hit.
 */

import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { createRestoreStats } from '@/lib/models'
import { formatRuntime } from '@/lib/config'

// ── Batch size for Composite Sobjects API inserts ─────────────────────────────
// Salesforce allows up to 200 records per composite/sobjects call.
const BATCH_SIZE = 200

// ── RFC 4180 CSV parser ────────────────────────────────────────────────────────
/**
 * Parse an RFC 4180 CSV string into a 2-D array of strings.
 * Handles: quoted fields, embedded commas, embedded newlines, doubled-quote escapes.
 * Matches the output format of lib/files/csv.js rowsToCSV().
 */
function parseCSV(text) {
  const rows = []
  const n    = text.length
  let i      = 0

  while (i < n) {
    const row = []

    while (i < n) {
      if (text[i] === '"') {
        // Quoted field
        i++ // skip opening quote
        let cell = ''
        while (i < n) {
          if (text[i] === '"') {
            if (i + 1 < n && text[i + 1] === '"') {
              cell += '"'
              i += 2
            } else {
              i++ // skip closing quote
              break
            }
          } else {
            cell += text[i++]
          }
        }
        row.push(cell)
      } else {
        // Unquoted field — read until comma or line ending
        let cell = ''
        while (i < n && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          cell += text[i++]
        }
        row.push(cell)
      }

      if (i < n && text[i] === ',') {
        i++ // separator — more fields follow
      } else {
        break // end of this row
      }
    }

    // Consume line ending (\r\n, \r, or \n)
    if (i < n && text[i] === '\r') i++
    if (i < n && text[i] === '\n') i++

    // Skip entirely empty trailing rows (final newline in file)
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row)
    }
  }

  return rows
}

// ── Dependency-aware import order (Kahn's topological sort) ──────────────────
/**
 * Sort objectNames so that parents come before children.
 * If a cycle exists (uncommon but possible via self-referential lookups) the
 * remaining objects are appended at the end — same fallback as SFRewind.
 *
 * @param {string[]} objectNames
 * @param {{ [obj]: Array<{ field, references, relationship_name }> }} relationships
 * @returns {string[]}
 */
function sortByDependency(objectNames, relationships) {
  const nameSet   = new Set(objectNames)
  const inDegree  = {}
  const dependsOn = {} // dependsOn[A] = Set of objects that A depends on

  for (const name of objectNames) {
    inDegree[name]  = 0
    dependsOn[name] = new Set()
  }

  for (const [obj, rels] of Object.entries(relationships || {})) {
    if (!nameSet.has(obj)) continue
    for (const rel of rels) {
      const ref = rel.references
      if (nameSet.has(ref) && ref !== obj && !dependsOn[obj].has(ref)) {
        dependsOn[obj].add(ref)
        inDegree[obj]++
      }
    }
  }

  // Queue starts with objects that have no dependencies
  const queue  = objectNames.filter(n => inDegree[n] === 0).sort()
  const sorted = []

  while (queue.length > 0) {
    const node = queue.shift()
    sorted.push(node)
    // Reduce in-degree for everything that depended on this node
    for (const obj of objectNames) {
      if (dependsOn[obj].has(node)) {
        dependsOn[obj].delete(node)
        inDegree[obj]--
        if (inDegree[obj] === 0) queue.push(obj)
      }
    }
  }

  // Append any objects still in a cycle
  const remaining = objectNames.filter(n => !sorted.includes(n))
  if (remaining.length > 0) {
    sorted.push(...remaining)
  }

  return sorted
}

// ── Main route ────────────────────────────────────────────────────────────────

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { metadata, csvData } = body

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!metadata?.objects) {
    return Response.json({ error: 'Invalid backup: metadata.json is missing or malformed.' }, { status: 400 })
  }
  if (!csvData || typeof csvData !== 'object') {
    return Response.json({ error: 'Invalid backup: no CSV data received.' }, { status: 400 })
  }

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const startMs = Date.now()
      const stats   = createRestoreStats()

      // Objects we have both metadata and CSV data for
      const objectNames = Object.keys(metadata.objects).filter(n => csvData[n])
      stats.totalObjects = objectNames.length

      if (!objectNames.length) {
        emit.error('No matching CSV files found for the objects in metadata.json.')
        return
      }

      const relationships   = metadata.relationships || {}
      const sortedObjects   = sortByDependency(objectNames, relationships)

      emit.info(`=== Restore — ${objectNames.length} object${objectNames.length !== 1 ? 's' : ''} ===`)
      emit.info(`Source backup: ${metadata.backup_name || 'unknown'} · ${metadata.created_at?.slice(0, 10) || ''}`)
      emit.info(`Target org: ${session.instanceUrl?.replace('https://', '')}`)
      emit.info(`Import order: ${sortedObjects.join(' → ')}`)

      // ── ID remap table ────────────────────────────────────────────────────
      // Salesforce always generates new IDs on insert — the original IDs from
      // the backup are thrown away. Without remapping, every lookup/reference
      // field on child objects (e.g. Contact.AccountId) would point to an ID
      // that no longer exists, even on the same org.
      //
      // As we insert each object we capture oldId → newId here, then for every
      // subsequent object we rewrite reference field values before inserting.
      // Salesforce IDs are globally unique (different key prefix per object),
      // so a single flat Map across all objects is safe.
      const idMap = new Map() // oldId → newId

      for (let i = 0; i < sortedObjects.length; i++) {
        const objName = sortedObjects[i]
        const csvText = csvData[objName]
        if (!csvText) continue

        const elapsed = (Date.now() - startMs) / 1000
        const pct     = Math.round((i / sortedObjects.length) * 88)
        emit.progress(pct, `[${i + 1}/${sortedObjects.length}] Restoring ${objName}…`, elapsed)

        try {
          // ── 1. Describe target object — get only insertable fields ────
          const describe = await client.describeSObject(objName)
          // Map of fieldName → SF type, for createable fields only.
          // We need the type to coerce CSV strings back to proper JSON types
          // before sending to the Composite API (booleans and numbers must not
          // be strings or SF will reject them with a type error).
          const createableFields = new Map(
            describe.fields
              .filter(f => f.createable)
              .map(f => [f.name, f.type])
          )

          // ── 2. Parse the backup CSV ───────────────────────────────────
          const parsed   = parseCSV(csvText)
          if (parsed.length < 2) {
            emit.warn(`  ⚠ ${objName}: CSV is empty, skipping`)
            stats.successfulObjects++
            continue
          }

          const headers  = parsed[0]
          const dataRows = parsed.slice(1)

          // Track the Id column so we can build the old→new mapping after insert.
          // Id is never createable so it won't appear in keepCols — we read it
          // separately here.
          const idColIdx = headers.indexOf('Id')

          // ── 3. Filter to createable columns only ──────────────────────
          // This removes: Id, CreatedDate, LastModifiedDate, SystemModstamp,
          // formula fields, auto-number fields, etc. — anything the API
          // won't accept in an insert. Mirrors SFRewind's field validation.
          const keepCols = headers
            .map((h, idx) => ({ h, idx, type: createableFields.get(h) }))
            .filter(({ type }) => type !== undefined)

          if (!keepCols.length) {
            emit.warn(`  ⚠ ${objName}: no createable fields found in backup CSV, skipping`)
            stats.successfulObjects++
            continue
          }

          const backupCount = metadata.objects[objName]?.record_count ?? dataRows.length
          emit.info(
            `  ${objName}: ${dataRows.length.toLocaleString()} rows · ` +
            `${keepCols.length} createable field${keepCols.length !== 1 ? 's' : ''} ` +
            `(of ${headers.length} backed up)`
          )

          // ── 4. Build record objects ────────────────────────────────────
          // Coerce CSV strings back to the proper JSON types SF expects.
          // For reference fields, remap old IDs → new IDs using idMap so that
          // lookup fields on child objects point to the newly inserted parents.
          const BOOLEAN_TYPES = new Set(['boolean'])
          const NUMERIC_TYPES = new Set(['int', 'double', 'currency', 'percent'])

          const filteredRows = dataRows.filter(row => row.some(c => c !== ''))

          const records = filteredRows.map(row => {
            const rec = {}
            for (const { h, idx, type } of keepCols) {
              const val = row[idx] ?? ''
              if (val === '') continue // let SF default apply
              if (BOOLEAN_TYPES.has(type)) {
                rec[h] = val.toLowerCase() === 'true'
              } else if (NUMERIC_TYPES.has(type)) {
                const n = Number(val)
                rec[h] = isNaN(n) ? val : n
              } else if (type === 'reference') {
                // Remap to new ID if this old ID was inserted in an earlier
                // object. If not in idMap (e.g. OwnerId pointing to a User
                // we didn't back up), keep the original — it may still be
                // valid in this org.
                rec[h] = idMap.get(val) ?? val
              } else {
                rec[h] = val
              }
            }
            return rec
          })

          // Collect old IDs in the same order as filteredRows so we can
          // align them with the insert results below.
          const oldIds = filteredRows.map(row =>
            idColIdx >= 0 ? (row[idColIdx] || null) : null
          )

          if (!records.length) {
            emit.info(`  ✓ ${objName}: 0 records to insert`)
            stats.successfulObjects++
            continue
          }

          // ── 5. Batch insert + capture old→new ID mapping ──────────────
          let inserted  = 0
          let failed    = 0
          let shownErrs = 0

          for (let b = 0; b < records.length; b += BATCH_SIZE) {
            const batch      = records.slice(b, b + BATCH_SIZE)
            const batchOldIds = oldIds.slice(b, b + BATCH_SIZE)
            const results    = await client.batchInsert(objName, batch)

            for (let j = 0; j < results.length; j++) {
              const r = results[j]
              if (r.success) {
                inserted++
                // Register old → new ID so child objects can remap their
                // reference fields before they are inserted.
                const oldId = batchOldIds[j]
                if (oldId && r.id) idMap.set(oldId, r.id)
              } else {
                failed++
                // Show first 3 distinct errors to keep the log readable
                if (shownErrs < 3) {
                  emit.warn(`    ⚠ Record failed: ${r.errors?.[0]?.message || 'Unknown error'}`)
                  shownErrs++
                } else if (shownErrs === 3) {
                  emit.warn(`    ⚠ …additional errors suppressed; check your org's import log`)
                  shownErrs++
                }
              }
            }
          }

          stats.totalRecordsInserted += inserted
          stats.totalRecordsFailed   += failed
          stats.successfulObjects++

          const remapped = keepCols.filter(c => c.type === 'reference').length
          const failNote = failed > 0 ? `, ${failed.toLocaleString()} failed` : ''
          const remapNote = remapped > 0 ? ` · ${remapped} lookup field${remapped !== 1 ? 's' : ''} remapped` : ''
          emit.success(`  ✓ ${objName}: ${inserted.toLocaleString()} inserted${failNote}${remapNote}`)

        } catch (err) {
          if (err.code === 'SESSION_EXPIRED') throw err
          emit.error(`  ✗ ${objName}: ${err.message}`)
          stats.failedObjects++
        }
      }

      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)

      // Restore has no download file — pass null so the page shows stats only
      emit.done(null, stats)
      emit.success(
        `=== Restore complete in ${stats.runtimeFormatted}` +
        ` — ${stats.totalRecordsInserted.toLocaleString()} records inserted` +
        (stats.totalRecordsFailed > 0 ? `, ${stats.totalRecordsFailed.toLocaleString()} failed` : '') +
        ` ===`
      )

    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') emit.error('Session expired. Please reconnect.')
      else emit.error(`Restore failed: ${err.message}`)
    } finally {
      end()
    }
  })()

  return response
}

// app/api/backup/export/route.js

/**
 * POST /api/backup/export
 *
 * Body: { objects: string[] }
 *
 * Streams SSE progress while querying each selected object, then
 * builds a ZIP containing one CSV per object plus a metadata.json.
 * Stores the result via the jobs store and emits a done event with
 * the download URL — same pattern as all other export modules.
 *
 * Ported from SFRewind/core/backup_manager.py (BackupManager.create_backup +
 * _export_object + _detect_relationships). Auth and file I/O are replaced by
 * the web app's existing SalesforceClient and jobs/store infrastructure.
 */

import JSZip from 'jszip'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { generateJobId, storeResult } from '@/lib/jobs/store'
import { rowsToCSV } from '@/lib/files/csv'
import { createBackupStats } from '@/lib/models'
import { formatRuntime, makeTimestamp } from '@/lib/config'

export async function POST(request) {
  const { objects = [] } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!objects.length) {
    return Response.json({ error: 'Select at least one object to backup.' }, { status: 400 })
  }

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const jobId   = generateJobId()
      const startMs = Date.now()
      const stats   = createBackupStats()
      stats.totalObjects = objects.length

      emit.info(`=== Backup — ${objects.length} object${objects.length !== 1 ? 's' : ''} ===`)
      emit.info(`Org: ${session.instanceUrl?.replace('https://', '')} · API v${session.apiVersion}`)

      const zip             = new JSZip()
      const metadataObjects = {}
      const relationships   = {}

      for (let i = 0; i < objects.length; i++) {
        const objName  = objects[i]
        const elapsed  = (Date.now() - startMs) / 1000
        const pct      = Math.round((i / objects.length) * 88)
        emit.progress(pct, `[${i + 1}/${objects.length}] Backing up ${objName}…`, elapsed)

        try {
          // ── 1. Describe — get all queryable fields ─────────────────────
          const describe = await client.describeSObject(objName)

          // Keep only fields that SOQL can SELECT; exclude deprecated ones
          // and compound types (address, location) which return nested objects
          // that can't be flattened into a CSV cell.
          // NOTE: f.queryable does NOT exist at the field level — it is an
          // SObject-level property only. The correct check is to exclude
          // compound types and deprecated/hidden fields.
          // base64 fields (Attachment.Body, ContentVersion.VersionData, etc.) are
          // large binary blobs that inflate the ZIP and break the restore body limit.
          const COMPOUND_TYPES = new Set(['address', 'location', 'base64'])
          const queryableFields = describe.fields
            .filter(f => !f.deprecatedAndHidden && !COMPOUND_TYPES.has(f.type))
            .map(f => f.name)

          // Ensure Id is always present and first (needed for relationship
          // detection and potential future incremental backups).
          if (!queryableFields.includes('Id')) queryableFields.unshift('Id')

          // ── 2. Query all records (paginated) ──────────────────────────
          const soql             = `SELECT ${queryableFields.join(', ')} FROM ${objName}`
          const { records, totalSize } = await client.queryAll(soql)

          // ── 3. Build CSV and add to ZIP ───────────────────────────────
          // rowsToCSV produces RFC 4180-compliant output — same escaping
          // the restore route's parser expects.
          const rows   = records.map(r => queryableFields.map(f => r[f] ?? ''))
          const csvStr = rowsToCSV(queryableFields, rows)
          zip.file(`${objName}.csv`, csvStr)

          // ── 4. Detect intra-backup relationships (mirrors _detect_relationships) ─
          const objRels = []
          for (const field of describe.fields) {
            if (field.type === 'reference' && field.referenceTo?.length) {
              for (const ref of field.referenceTo) {
                if (objects.includes(ref) && ref !== objName) {
                  objRels.push({
                    field:             field.name,
                    references:        ref,
                    relationship_name: field.relationshipName ?? null,
                  })
                }
              }
            }
          }
          if (objRels.length) relationships[objName] = objRels

          // ── 5. Record metadata ────────────────────────────────────────
          metadataObjects[objName] = {
            fields:       queryableFields,
            record_count: totalSize,
            file:         `${objName}.csv`,
          }

          stats.successfulObjects++
          stats.totalRecords += totalSize
          emit.success(
            `  ✓ ${objName}: ${totalSize.toLocaleString()} record${totalSize !== 1 ? 's' : ''}` +
            ` · ${queryableFields.length} field${queryableFields.length !== 1 ? 's' : ''}`
          )

        } catch (err) {
          if (err.code === 'SESSION_EXPIRED') throw err
          emit.error(`  ✗ ${objName}: ${err.message}`)
          stats.failedObjects++
        }
      }

      // ── Build metadata.json (mirrors Python metadata dict) ─────────────
      const timestamp  = makeTimestamp()
      const backupName = `backup_${timestamp}`
      const metadata   = {
        backup_name:  backupName,
        timestamp,
        created_at:   new Date().toISOString(),
        org_instance: session.instanceUrl,
        api_version:  session.apiVersion,
        objects:      metadataObjects,
        relationships,
      }
      zip.file('metadata.json', JSON.stringify(metadata, null, 2))

      // ── Compress and store ─────────────────────────────────────────────
      emit.progress(94, 'Compressing backup…', (Date.now() - startMs) / 1000)
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })

      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)

      storeResult(jobId, {
        buffer:      zipBuffer,
        filename:    `${backupName}.zip`,
        contentType: 'application/zip',
      })

      emit.done(`/api/backup/download/${jobId}`, stats)
      emit.success(
        `=== Backup complete in ${stats.runtimeFormatted}` +
        ` — ${stats.totalRecords.toLocaleString()} records across` +
        ` ${stats.successfulObjects} object${stats.successfulObjects !== 1 ? 's' : ''} ===`
      )

    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') emit.error('Session expired. Please reconnect.')
      else emit.error(`Backup failed: ${err.message}`)
    } finally {
      end()
    }
  })()

  return response
}

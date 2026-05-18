/**
 * POST /api/metadata/export
 *
 * Mirrors metadata_exporter.py + field_usage_tracker.py.
 * Exports all fields for selected objects as a 15-column Excel file.
 *
 * Body: {
 *   objects:           string[],
 *   includeDescriptions: boolean,   // fetch Description via Tooling FieldDefinition
 *   includeFieldUsage:   boolean,   // run all 13 field usage queries per object (slower)
 * }
 */

import * as XLSX from 'xlsx-js-style'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { generateJobId, storeResult } from '@/lib/jobs/store'
import JSZip from 'jszip'
import { createStyledSheet, addSummarySheet, workbookToBuffer, newWorkbook, appendSheet, safeSheetName, buildCsvBuffer } from '@/lib/files/excel'
import { createMetadataStats } from '@/lib/models'
import { buildObjectUsageCache, getFieldUsageString } from '@/lib/salesforce/fieldUsage'
import { formatRuntime, makeTimestamp, DEFAULT_METADATA_FILENAME } from '@/lib/config'

// ── Exact 15 column headers from models.py MetadataField ─────────────────────
const HEADERS = [
  'Object Name', 'Field Label', 'API Name', 'Data Type', 'Length',
  'Field Type', 'Required', 'Picklist Values', 'Formula',
  'External ID', 'Track History', 'Description', 'Help Text',
  'Attributes', 'Field Usage',
]

/** Map Salesforce field type strings to human-readable labels */
function formatDataType(field) {
  const map = {
    string:       'Text',
    boolean:      'Checkbox',
    int:          'Number',
    double:       'Number',
    currency:     'Currency',
    percent:      'Percent',
    date:         'Date',
    datetime:     'Date/Time',
    time:         'Time',
    id:           'ID',
    reference:    'Lookup',
    textarea:     'Text Area',
    richtext:     'Rich Text Area',
    picklist:     'Picklist',
    multipicklist:'Multi-Select Picklist',
    email:        'Email',
    phone:        'Phone',
    url:          'URL',
    address:      'Address',
    location:     'Geolocation',
    encrypted:    'Text (Encrypted)',
    anyType:      'Any Type',
    complexvalue: 'Complex Value',
    base64:       'Base64',
    combobox:     'Combobox',
    datacategorygroupreference: 'Data Category',
  }
  return map[field.type] || field.type
}

/** Format length/precision based on field type */
function formatLength(field) {
  if (['string', 'textarea', 'richtext', 'encrypted', 'email', 'phone', 'url'].includes(field.type)) {
    return field.length ? String(field.length) : ''
  }
  if (field.type === 'int' && field.digits) return String(field.digits)
  if (['double', 'currency', 'percent'].includes(field.type)) {
    return field.precision != null ? `${field.precision}, ${field.scale}` : ''
  }
  return ''
}

/** Comma-separated active picklist value labels */
function formatPicklistValues(field) {
  if (!field.picklistValues?.length) return ''
  return field.picklistValues
    .filter(v => v.active)
    .map(v => v.label)
    .join(', ')
}

/** Build the Attributes column — comma-separated list of special attributes */
function formatAttributes(field) {
  const attrs = []
  if (field.unique)        attrs.push('Unique')
  if (field.caseSensitive) attrs.push('Case Sensitive')
  if (field.autoNumber)    attrs.push('Auto Number')
  if (field.calculated)    attrs.push('Formula')
  if (field.encrypted)     attrs.push('Encrypted')
  if (field.externalId)    attrs.push('External ID')
  if (field.idLookup)      attrs.push('ID Lookup')
  if (field.nameField)     attrs.push('Name Field')
  if (!field.filterable)   attrs.push('Not Filterable')
  if (!field.sortable)     attrs.push('Not Sortable')
  if (!field.groupable)    attrs.push('Not Groupable')
  return attrs.join(', ')
}

/**
 * Fetch Description + TrackHistory for all fields in one object via Tooling API.
 * FieldDefinition supports batch Metadata queries (unlike Layout/ValidationRule).
 *
 * Returns Map<fieldApiName, { description, helpText, trackHistory }>
 */
async function fetchFieldDefinitions(client, objectName) {
  const result = new Map()

  try {
    const data = await client.toolingQuery(
      `SELECT QualifiedApiName, Description, Metadata 
       FROM FieldDefinition 
       WHERE EntityDefinition.QualifiedApiName = '${objectName}'`
    )

    for (const record of (data.records || [])) {
      const fieldName = record.QualifiedApiName?.split('.').pop()
      if (!fieldName) continue
      result.set(fieldName, {
        description:  record.Description || '',
        trackHistory: record.Metadata?.trackHistory === true ? 'Yes' : '',
      })
    }
  } catch {
    // Tooling API not available — leave descriptions empty
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  const {
    objects             = [],
    includeDescriptions = true,
    includeFieldUsage   = false,
    exportMode          = 'multi_tab',
    csvMode             = false,
  } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!objects.length) {
    return Response.json({ error: 'Select at least one object.' }, { status: 400 })
  }

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const jobId   = generateJobId()
      const startMs = Date.now()
      const stats   = createMetadataStats()
      const usedSheetNames = new Set()

      stats.totalObjects = objects.length

      const wb = newWorkbook()
      const zipFiles = []  // for multi_file mode

      emit.info('=== Metadata Exporter ===')
      emit.info(`Objects: ${objects.length} | Descriptions: ${includeDescriptions ? 'Yes' : 'No'} | Field Usage: ${includeFieldUsage ? 'Yes (slower)' : 'No'}`)

      const sorted = [...objects].sort()

      for (let i = 0; i < sorted.length; i++) {
        const objName  = sorted[i]
        const elapsed  = (Date.now() - startMs) / 1000
        const percent  = Math.round((i / sorted.length) * (includeFieldUsage ? 80 : 88))

        emit.progress(percent, `[${i + 1}/${sorted.length}] Processing ${objName}…`, elapsed)

        try {
          // 1. REST describe — main field data
          const describe = await client.describeSObject(objName)

          // 2. Tooling FieldDefinition — description + trackHistory (optional)
          let fieldDefs = new Map()
          if (includeDescriptions) {
            emit.info(`  › Fetching field definitions…`)
            fieldDefs = await fetchFieldDefinitions(client, objName)
          }

          // 3. Field usage tracker — 13 sources (optional)
          let usageCache = {}
          if (includeFieldUsage) {
            emit.info(`  › Building field usage cache (this may take a moment)…`)
            usageCache = await buildObjectUsageCache(
              client,
              objName,
              msg => emit.info(msg)
            )
          }

          // 4. Build one row per field
          const rows = []

          for (const field of describe.fields) {
            const fd           = fieldDefs.get(field.name) || {}
            const fieldUsageStr = includeFieldUsage
              ? getFieldUsageString(usageCache, objName, field.name)
              : ''

            rows.push([
              objName,
              field.label,
              field.name,
              formatDataType(field),
              formatLength(field),
              field.soapType || '',
              !field.nillable && field.createable ? 'Yes' : '',
              formatPicklistValues(field),
              field.calculatedFormula || '',
              field.externalId    ? 'Yes' : '',
              fd.trackHistory || '',
              fd.description  || '',
              field.inlineHelpText || '',
              formatAttributes(field),
              fieldUsageStr,
            ])
          }

          // Add sheet / file depending on mode
          const exportDate = new Date().toLocaleString('en-US', { hour12: false }).replace(',', '')

          if (exportMode === 'multi_file') {
            if (csvMode) {
              const buf = buildCsvBuffer(HEADERS, rows)
              zipFiles.push({ name: `${objName}_metadata.csv`, buffer: buf })
            } else {
              const fileWb = newWorkbook()
              const ws = createStyledSheet(HEADERS, rows, {
                wrapText:    includeFieldUsage,
                title:       'Salesforce Metadata Export',
                summaryLine: `Object: ${objName} | Fields: ${rows.length} | Export Date: ${exportDate}`,
              })
              appendSheet(fileWb, ws, safeSheetName(objName, new Set()))
              zipFiles.push({ name: `${objName}_metadata.xlsx`, buffer: workbookToBuffer(fileWb) })
            }
          } else {
            // multi_tab (default) — one sheet per object in single workbook
            if (!csvMode) {
              const ws = createStyledSheet(HEADERS, rows, {
                wrapText:    includeFieldUsage,
                title:       'Salesforce Metadata Export',
                summaryLine: `Object: ${objName} | Fields: ${rows.length} | Export Date: ${exportDate}`,
              })
              appendSheet(wb, ws, safeSheetName(objName, usedSheetNames))
            }
          }

          stats.totalFields       += rows.length
          stats.successfulObjects++

          emit.info(`  ✓ ${objName}: ${rows.length} field(s) exported`)

        } catch (err) {
          if (err.code === 'SESSION_EXPIRED') throw err
          emit.error(`  ✗ ${objName}: ${err.message}`)
          stats.failedObjects++
          stats.failedObjectDetails.push({ name: objName, reason: err.message })
        }
      }

      // Summary sheet
      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)



      emit.progress(96, 'Building output…', elapsed)

      let finalBuffer, filename, contentType
      const timestamp = makeTimestamp()

      if (exportMode === 'multi_file') {
        // Add summary to ZIP
        const sumWb = newWorkbook()
        addSummarySheet(sumWb, buildSummaryRows(stats, exportMode, csvMode, includeDescriptions, includeFieldUsage, session), 'Summary')
        zipFiles.push({ name: 'Summary.xlsx', buffer: workbookToBuffer(sumWb) })

        emit.progress(97, 'Zipping files…')
        const zip = new JSZip()
        zipFiles.forEach(f => zip.file(f.name, f.buffer))
        finalBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
        filename    = `metadata_export_${timestamp}.zip`
        contentType = 'application/zip'

      } else if (csvMode) {
        // Combine all rows into single CSV
        const allRows = []
        // Re-collect from wb is not possible; for CSV in multi_tab mode we stored nothing
        // So emit a note — csvMode + multi_tab is treated as multi_file
        emit.warn('CSV mode with Multi-Tab is not supported — use Multi-File or Single-File CSV instead.')
        finalBuffer = Buffer.from('No data', 'utf8')
        filename    = `metadata_export_${timestamp}.txt`
        contentType = 'text/plain'
      } else {
        addSummarySheet(wb, buildSummaryRows(stats, exportMode, csvMode, includeDescriptions, includeFieldUsage, session), 'Summary')
        finalBuffer = workbookToBuffer(wb)
        filename    = `metadata_export_${timestamp}.xlsx`
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }

      storeResult(jobId, { buffer: finalBuffer, filename, contentType })

      emit.done(`/api/metadata/download/${jobId}`, stats)
      emit.success(`=== Export complete in ${stats.runtimeFormatted} ===`)

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

function buildSummaryRows(stats, exportMode, csvMode, includeDescriptions, includeFieldUsage, session) {
  const modeLabel = csvMode
    ? (exportMode === 'multi_file' ? 'CSV Multi-File ZIP' : 'CSV')
    : exportMode === 'multi_file' ? 'Multi-File ZIP' : 'Multi-Tab (Single File)'
  return [
    ['Metadata Export Summary',  ''],
    ['',                         ''],
    ['Export Mode',              modeLabel],
    ['',                         ''],
    ['Total Objects Selected',   String(stats.totalObjects)],
    ['Successfully Processed',   String(stats.successfulObjects)],
    ['Failed',                   String(stats.failedObjects)],
    ['',                         ''],
    ['Total Fields Exported',    String(stats.totalFields)],
    ['',                         ''],
    ['Descriptions Included',    includeDescriptions ? 'Yes' : 'No'],
    ['Field Usage Included',     includeFieldUsage   ? 'Yes' : 'No'],
    ['',                         ''],
    ['Runtime',                  stats.runtimeFormatted],
    ['Exported At',              new Date().toISOString()],
    ['API Version',              session.apiVersion],
    ['Org',                      session.instanceUrl?.replace('https://', '')],
  ]
}
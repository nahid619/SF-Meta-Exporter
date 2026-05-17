/**
 * POST /api/picklist/export
 *
 * Mirrors PicklistExporter.export_picklists_excel() from picklist_exporter.py.
 * Streams SSE progress while processing each object, then stores the completed
 * .xlsx in the job store and emits a done event with the download URL.
 *
 * Body: { objects: string[], exportMode?: 'single_tab'|'multi_tab' }
 */

import * as XLSX from 'xlsx-js-style'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { generateJobId, storeResult } from '@/lib/jobs/store'
import { createStyledSheet, addSummarySheet, workbookToBuffer, newWorkbook, appendSheet, safeSheetName } from '@/lib/files/excel'
import { createPicklistStats } from '@/lib/models'
import { formatRuntime, makeTimestamp, DEFAULT_PICKLIST_FILENAME } from '@/lib/config'

const HEADERS = [
  'Object',
  'Field Label',
  'Field API',
  'Picklist Value Label',
  'Picklist Value API',
  'Status',
  'IsGlobal?',
]

/**
 * For each custom picklist field (name ending __c), fetch its Tooling API Metadata.
 * This is the ONLY way to get:
 *   1. Inactive picklist values  — describeSObject only returns active ones
 *   2. Global Value Set detection — valueSet.valueSetName present means global
 *
 * Key SF Tooling API constraint: Metadata field must be fetched ONE record at a time.
 * A batch IN-clause query with Metadata in the SELECT silently fails or errors.
 *
 * Returns Map<fieldApiName, { isGlobal: bool, allValues: [{label,value,active}]|null }>
 *   allValues is null for global fields (values come from the GlobalValueSet, not inline)
 *   — in that case caller falls back to describeSObject values (which ARE correct for globals).
 */
async function fetchCustomPicklistDetails(client, objectName, customPicklistFields) {
  const details = new Map()

  for (const field of customPicklistFields) {
    details.set(field.name, { isGlobal: false, allValues: null })
    try {
      // Strip __c suffix to get DeveloperName
      const devName = field.name.replace(/__c$/i, '')
      const result  = await client.toolingQuery(
        `SELECT Metadata FROM CustomField ` +
        `WHERE DeveloperName = '${devName}' AND TableEnumOrId = '${objectName}'`
      )
      const meta = result.records?.[0]?.Metadata
      if (!meta) continue

      const isGlobal = !!(meta.valueSet?.valueSetName)
      details.set(field.name, {
        isGlobal,
        // For local value sets: extract all values including inactive
        // For global value sets: allValues = null → caller uses describe values
        allValues: (!isGlobal && meta.valueSet?.valueSetDefinition?.value)
          ? meta.valueSet.valueSetDefinition.value.map(v => ({
              label:  v.label || v.valueName,
              value:  v.valueName,
              active: v.isActive !== false,
            }))
          : null,
      })
    } catch {
      // Non-fatal: fall back to describe values, not marked global
    }
  }

  return details
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  const { objects = [], exportMode = 'single_tab' } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!objects.length) {
    return Response.json({ error: 'Select at least one object to export.' }, { status: 400 })
  }

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const jobId   = generateJobId()
      const startMs = Date.now()
      const stats   = createPicklistStats()
      const usedSheetNames = new Set()

      stats.totalObjects = objects.length

      const wb      = newWorkbook()
      const allRows = [] // single_tab only

      emit.info(`=== Picklist Export (${exportMode === 'multi_tab' ? 'Multi-Tab' : 'Single Tab'}) ===`)
      emit.info(`Objects to process: ${objects.length}`)

      const sortedObjects = [...objects].sort()

      for (let i = 0; i < sortedObjects.length; i++) {
        const objName = sortedObjects[i]
        const elapsed = (Date.now() - startMs) / 1000
        const percent = Math.round((i / sortedObjects.length) * 88)

        emit.progress(percent, `[${i + 1}/${sortedObjects.length}] Processing ${objName}…`, elapsed)

        try {
          const describe = await client.describeSObject(objName)

          const picklistFields = describe.fields.filter(f =>
            f.type === 'picklist' || f.type === 'multipicklist'
          )

          if (picklistFields.length === 0) {
            emit.warn(`  ⚠ ${objName}: no picklist fields — skipped`)
            stats.objectsNoPicklists++
            stats.successfulObjects++
            continue
          }

          // Fetch Tooling API metadata for custom fields only.
          // This gives us inactive values + global detection in one step per field.
          const customFields   = picklistFields.filter(f => f.name.endsWith('__c'))
          const customDetails  = await fetchCustomPicklistDetails(client, objName, customFields)

          const objRows = []
          let activeCount = 0, inactiveCount = 0, globalCount = 0

          for (const field of picklistFields) {
            const detail   = customDetails.get(field.name)
            const isGlobal = detail?.isGlobal ?? false
            if (isGlobal) globalCount++

            // Prefer Tooling API values (includes inactive) for local custom fields.
            // For standard fields and global custom fields, use describe values.
            const rawValues = detail?.allValues
              ?? (field.picklistValues || []).map(v => ({
                  label:  v.label,
                  value:  v.value,
                  active: v.active,
                }))

            if (rawValues.length === 0) {
              objRows.push([
                objName, field.label, field.name,
                '(no values)', '', '', isGlobal ? 'Yes' : '',
              ])
            } else {
              for (const v of rawValues) {
                const isActive = v.active !== false  // default true if undefined
                objRows.push([
                  objName, field.label, field.name,
                  v.label, v.value,
                  isActive ? 'Active' : 'Inactive',
                  isGlobal ? 'Yes' : '',
                ])
                isActive ? activeCount++ : inactiveCount++
              }
            }

            stats.totalPicklistFields++
          }

          if (exportMode === 'multi_tab') {
            const ws = createPicklistSheet(objName, objRows)
            appendSheet(wb, ws, safeSheetName(objName, usedSheetNames))
          } else {
            allRows.push(...objRows)
          }

          const valueCount = activeCount + inactiveCount
          stats.totalValues         += valueCount
          stats.totalActiveValues   += activeCount
          stats.totalInactiveValues += inactiveCount
          stats.globalPicklistCount += globalCount
          stats.successfulObjects++

          emit.info(
            `  ✓ ${objName}: ${picklistFields.length} field(s), ` +
            `Active: ${activeCount}, Inactive: ${inactiveCount}` +
            (globalCount ? `, Global: ${globalCount}` : '')
          )

        } catch (err) {
          if (err.code === 'SESSION_EXPIRED') throw err
          emit.error(`  ✗ ${objName}: ${err.message}`)
          stats.failedObjects++
          stats.failedObjectDetails.push({ name: objName, reason: err.message })
        }
      }

      if (exportMode === 'single_tab') {
        emit.progress(90, 'Building combined sheet…')
        const exportDate = new Date().toLocaleString('en-US', { hour12: false })
          .replace(',', '')
        const ws = createPicklistSheet(
          `Objects: ${stats.successfulObjects} | ` +
          `Total Picklist Values: ${stats.totalValues} | ` +
          `Global Picklists: ${stats.globalPicklistCount} | ` +
          `Export Date: ${exportDate}`,
          allRows
        )
        appendSheet(wb, ws, 'Picklist Data')
      }

      const elapsed = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)

      addSummarySheet(wb, [
        ['Picklist Export Summary',  ''],
        ['',                         ''],
        ['Export Mode',              exportMode === 'multi_tab' ? 'Multi-Tab' : 'Single Tab'],
        ['',                         ''],
        ['Total Objects Selected',   String(stats.totalObjects)],
        ['Successfully Processed',   String(stats.successfulObjects)],
        ['Failed',                   String(stats.failedObjects)],
        ['No Picklist Fields',       String(stats.objectsNoPicklists)],
        ['',                         ''],
        ['Total Picklist Fields',    String(stats.totalPicklistFields)],
        ['  incl. Global Picklists', String(stats.globalPicklistCount)],
        ['',                         ''],
        ['Total Values',             String(stats.totalValues)],
        ['  Active',                 String(stats.totalActiveValues)],
        ['  Inactive',               String(stats.totalInactiveValues)],
        ['',                         ''],
        ['Runtime',                  stats.runtimeFormatted],
        ['Exported At',              new Date().toISOString()],
        ['API Version',              session.apiVersion],
        ['Org',                      session.instanceUrl?.replace('https://', '')],
      ], 'Summary')

      emit.progress(96, 'Generating Excel file…', elapsed)

      const buffer = workbookToBuffer(wb)
      storeResult(jobId, {
        buffer,
        filename:    DEFAULT_PICKLIST_FILENAME.replace('{timestamp}', makeTimestamp()),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

      emit.done(`/api/picklist/download/${jobId}`, stats)
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

// ─── Sheet builder matching Python format ─────────────────────────────────────

/**
 * Creates the picklist data sheet with the Python-style title header rows.
 * Row 1: "Salesforce Picklist Export" (bold, merged-look title)
 * Row 2: summary string (e.g. "Objects: 1 | Total Picklist Values: 51 | …")
 * Row 3: column headers (blue, bold)
 * Row 4+: data rows
 */
function createPicklistSheet(summaryLine, rows) {
  const TITLE_FILL   = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
  const TITLE_FONT   = { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }
  const HEADER_FILL  = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
  const HEADER_FONT  = { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }
  const SUMMARY_FILL = { patternType: 'solid', fgColor: { rgb: '1C4587' } }
  const SUMMARY_FONT = { color: { rgb: 'FFFFFF' }, sz: 10 }
  const DATA_FONT    = { sz: 10 }
  const DATA_ALIGN   = { vertical: 'top', wrapText: true }

  const numCols = HEADERS.length

  // Use ' ' (space) not '' for empty merged cells.
  // SheetJS silently skips cells where v==='' when writing the XLSX binary,
  // so the fill style never reaches the file. A space forces a real cell object.
  const PAD = ' '
  const aoa = [
    ['Salesforce Picklist Export', ...Array(numCols - 1).fill(PAD)],
    [summaryLine,                  ...Array(numCols - 1).fill(PAD)],
    [...HEADERS],
    ...rows,
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Merge title and summary rows across all columns so text isn't cut off.
  // xlsx-js-style correctly propagates fill through merged ranges.
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } },
  ]

  // Title row (row 0)
  for (let c = 0; c < numCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c })
    if (!ws[addr]) ws[addr] = { t: 's', v: ' ' }
    ws[addr].s = { fill: TITLE_FILL, font: TITLE_FONT, alignment: { horizontal: 'left', vertical: 'center' } }
  }

  // Summary row (row 1)
  for (let c = 0; c < numCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 1, c })
    if (!ws[addr]) ws[addr] = { t: 's', v: ' ' }
    ws[addr].s = { fill: SUMMARY_FILL, font: SUMMARY_FONT, alignment: { vertical: 'center' } }
  }

  // Style header row (row 2)
  HEADERS.forEach((_, c) => {
    const addr = XLSX.utils.encode_cell({ r: 2, c })
    if (ws[addr]) ws[addr].s = {
      fill:      HEADER_FILL,
      font:      HEADER_FONT,
      alignment: { horizontal: 'left', vertical: 'center' },
      border:    { top: { style: 'thin', color: { rgb: 'FFFFFF' } }, bottom: { style: 'thin', color: { rgb: 'FFFFFF' } } },
    }
  })

  // Style data rows (row 3+)
  rows.forEach((row, ri) => {
    row.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: ri + 3, c })
      if (ws[addr]) ws[addr].s = { font: DATA_FONT, alignment: DATA_ALIGN }
    })
  })

  // Column widths
  ws['!cols'] = HEADERS.map((h, i) => {
    const maxLen = Math.max(
      String(h).length,
      ...rows.slice(0, 500).map(r => String(r[i] ?? '').length)
    )
    return { wch: Math.min(Math.max(maxLen + 2, 8), 80) }
  })

  // Freeze at row 3 (below title + summary + header)
  ws['!freeze'] = { xSplit: 0, ySplit: 3, topLeftCell: 'A4', activePane: 'bottomLeft' }

  ws['!rows'] = [
    { hpt: 24 },  // title
    { hpt: 18 },  // summary
    { hpt: 20 },  // headers
    ...rows.map(() => ({ hpt: 15 })),
  ]

  return ws
}
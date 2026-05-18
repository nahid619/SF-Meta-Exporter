/**
 * POST /api/picklist/export
 *
 * Body: {
 *   objects: string[],
 *   exportMode?: 'single_tab' | 'multi_tab' | 'multi_file',
 *   csvMode?: boolean,
 * }
 *
 * Modes:
 *   single_tab  — all objects in one sheet (excel) or one CSV file
 *   multi_tab   — one tab per object in one Excel file (csv: ignored, same as single_tab)
 *   multi_file  — one file per object, zipped together with a summary
 */

import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { generateJobId, storeResult } from '@/lib/jobs/store'
import { addSummarySheet, workbookToBuffer, newWorkbook, appendSheet, safeSheetName, buildCsvBuffer } from '@/lib/files/excel'
import { createPicklistStats } from '@/lib/models'
import { formatRuntime, makeTimestamp } from '@/lib/config'

const HEADERS = [
  'Object', 'Field Label', 'Field API',
  'Picklist Value Label', 'Picklist Value API', 'Status', 'IsGlobal?',
]

// ─── Tooling API: fetch inactive values + global detection ───────────────────

async function fetchCustomPicklistDetails(client, objectName, customPicklistFields) {
  const details = new Map()
  for (const field of customPicklistFields) {
    details.set(field.name, { isGlobal: false, allValues: null })
    try {
      const devName = field.name.replace(/__c$/i, '')
      const result  = await client.toolingQuery(
        `SELECT Metadata FROM CustomField WHERE DeveloperName = '${devName}' AND TableEnumOrId = '${objectName}'`
      )
      const meta = result.records?.[0]?.Metadata
      if (!meta) continue
      const isGlobal = !!(meta.valueSet?.valueSetName)
      details.set(field.name, {
        isGlobal,
        allValues: (!isGlobal && meta.valueSet?.valueSetDefinition?.value)
          ? meta.valueSet.valueSetDefinition.value.map(v => ({
              label: v.label || v.valueName, value: v.valueName, active: v.isActive !== false,
            }))
          : null,
      })
    } catch { /* non-fatal */ }
  }
  return details
}

// ─── Sheet / CSV builders ────────────────────────────────────────────────────

function buildPicklistSheet(titleLine, summaryLine, rows) {
  const TITLE_FILL   = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
  const TITLE_FONT   = { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }
  const SUMMARY_FILL = { patternType: 'solid', fgColor: { rgb: '1C4587' } }
  const SUMMARY_FONT = { color: { rgb: 'FFFFFF' }, sz: 10 }
  const HEADER_FILL  = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
  const HEADER_FONT  = { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }
  const DATA_FONT    = { sz: 10 }
  const DATA_ALIGN   = { vertical: 'top', wrapText: true }
  const numCols      = HEADERS.length
  const PAD          = ' '

  const aoa = [
    [titleLine,   ...Array(numCols - 1).fill(PAD)],
    [summaryLine, ...Array(numCols - 1).fill(PAD)],
    [...HEADERS],
    ...rows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } },
  ]

  for (let c = 0; c < numCols; c++) {
    const a0 = XLSX.utils.encode_cell({ r: 0, c })
    const a1 = XLSX.utils.encode_cell({ r: 1, c })
    if (!ws[a0]) ws[a0] = { t: 's', v: PAD }
    if (!ws[a1]) ws[a1] = { t: 's', v: PAD }
    ws[a0].s = { fill: TITLE_FILL,   font: TITLE_FONT,   alignment: { horizontal: 'left', vertical: 'center' } }
    ws[a1].s = { fill: SUMMARY_FILL, font: SUMMARY_FONT, alignment: { vertical: 'center' } }
  }
  HEADERS.forEach((_, c) => {
    const addr = XLSX.utils.encode_cell({ r: 2, c })
    if (ws[addr]) ws[addr].s = { fill: HEADER_FILL, font: HEADER_FONT, alignment: { horizontal: 'left', vertical: 'center' } }
  })
  rows.forEach((row, ri) => {
    row.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: ri + 3, c })
      if (ws[addr]) ws[addr].s = { font: DATA_FONT, alignment: DATA_ALIGN }
    })
  })
  ws['!cols']   = HEADERS.map((h, i) => ({ wch: Math.min(Math.max(Math.max(String(h).length, ...rows.slice(0, 200).map(r => String(r[i] ?? '').length)) + 2, 8), 80) }))
  ws['!freeze'] = { xSplit: 0, ySplit: 3, topLeftCell: 'A4', activePane: 'bottomLeft' }
  ws['!rows']   = [{ hpt: 24 }, { hpt: 18 }, { hpt: 20 }, ...rows.map(() => ({ hpt: 15 }))]
  return ws
}

// ─── Main route ──────────────────────────────────────────────────────────────

export async function POST(request) {
  const { objects = [], exportMode = 'single_tab', csvMode = false } = await request.json()

  const session = await getSession()
  if (!session.accessToken) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!objects.length)      return Response.json({ error: 'Select at least one object.' }, { status: 400 })

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client  = SalesforceClient.fromSession(session)
      const jobId   = generateJobId()
      const startMs = Date.now()
      const stats   = createPicklistStats()
      stats.totalObjects = objects.length

      const modeLabel = csvMode
        ? (exportMode === 'multi_file' ? 'CSV Multi-File' : 'CSV Single File')
        : exportMode === 'multi_tab' ? 'Multi-Tab' : exportMode === 'multi_file' ? 'Multi-File ZIP' : 'Single Tab'

      emit.info(`=== Picklist Export (${modeLabel}) ===`)
      emit.info(`Objects to process: ${objects.length}`)

      // Containers
      const wb          = newWorkbook()  // for single_tab / multi_tab Excel
      const allRows     = []             // for single_tab
      const usedNames   = new Set()
      const zipFiles    = []             // [{ name, buffer }] for multi_file

      for (let i = 0; i < objects.length; i++) {
        const objName  = objects[i]
        const elapsed  = (Date.now() - startMs) / 1000
        const pct      = Math.round((i / objects.length) * 88)
        emit.progress(pct, `[${i + 1}/${objects.length}] Processing ${objName}…`, elapsed)

        try {
          const describe       = await client.describeSObject(objName)
          const picklistFields = describe.fields.filter(f => f.type === 'picklist' || f.type === 'multipicklist')

          if (!picklistFields.length) {
            emit.warn(`  ⚠ ${objName}: no picklist fields — skipped`)
            stats.objectsNoPicklists++; stats.successfulObjects++
            continue
          }

          const customFields  = picklistFields.filter(f => f.name.endsWith('__c'))
          const customDetails = await fetchCustomPicklistDetails(client, objName, customFields)
          const objRows = []
          let active = 0, inactive = 0, global = 0

          for (const field of picklistFields) {
            const detail   = customDetails.get(field.name)
            const isGlobal = detail?.isGlobal ?? false
            if (isGlobal) global++

            const rawValues = detail?.allValues
              ?? (field.picklistValues || []).map(v => ({ label: v.label, value: v.value, active: v.active }))

            if (!rawValues.length) {
              objRows.push([objName, field.label, field.name, '(no values)', '', '', isGlobal ? 'Yes' : ''])
            } else {
              for (const v of rawValues) {
                const isActive = v.active !== false
                objRows.push([objName, field.label, field.name, v.label, v.value, isActive ? 'Active' : 'Inactive', isGlobal ? 'Yes' : ''])
                isActive ? active++ : inactive++
              }
            }
            stats.totalPicklistFields++
          }

          // --- Store per mode ---
          if (exportMode === 'multi_tab' && !csvMode) {
            const exportDate = new Date().toLocaleString('en-US', { hour12: false }).replace(',', '')
            const ws = buildPicklistSheet(
              'Salesforce Picklist Export',
              `Object: ${objName} | Fields: ${picklistFields.length} | Values: ${active + inactive} | Export Date: ${exportDate}`,
              objRows
            )
            appendSheet(wb, ws, safeSheetName(objName, usedNames))
          } else if (exportMode === 'multi_file') {
            if (csvMode) {
              const buf = buildCsvBuffer(HEADERS, objRows)
              zipFiles.push({ name: `${objName}_picklists.csv`, buffer: buf })
            } else {
              const exportDate = new Date().toLocaleString('en-US', { hour12: false }).replace(',', '')
              const fileWb = newWorkbook()
              const ws = buildPicklistSheet(
                'Salesforce Picklist Export',
                `Object: ${objName} | Fields: ${picklistFields.length} | Values: ${active + inactive} | Export Date: ${exportDate}`,
                objRows
              )
              appendSheet(fileWb, ws, 'Picklist Data')
              zipFiles.push({ name: `${objName}_picklists.xlsx`, buffer: workbookToBuffer(fileWb) })
            }
          } else {
            // single_tab (Excel or CSV)
            allRows.push(...objRows)
          }

          stats.totalValues         += active + inactive
          stats.totalActiveValues   += active
          stats.totalInactiveValues += inactive
          stats.globalPicklistCount  = (stats.globalPicklistCount || 0) + global
          stats.successfulObjects++
          emit.info(`  ✓ ${objName}: ${picklistFields.length} field(s), Active: ${active}, Inactive: ${inactive}${global ? `, Global: ${global}` : ''}`)

        } catch (err) {
          if (err.code === 'SESSION_EXPIRED') throw err
          emit.error(`  ✗ ${objName}: ${err.message}`)
          stats.failedObjects++
          stats.failedObjectDetails?.push({ name: objName, reason: err.message })
        }
      }

      // --- Build final file ---
      emit.progress(92, 'Building output…')
      const elapsed      = (Date.now() - startMs) / 1000
      stats.runtimeFormatted = formatRuntime(elapsed)
      const timestamp    = makeTimestamp()

      let finalBuffer, filename, contentType

      if (exportMode === 'multi_file') {
        // Add summary sheet/CSV to ZIP
        const sumWb = newWorkbook()
        addSummarySheet(sumWb, buildSummaryRows(stats, modeLabel, session), 'Summary')
        zipFiles.push({ name: 'Summary.xlsx', buffer: workbookToBuffer(sumWb) })

        emit.progress(95, 'Zipping files…')
        const zip = new JSZip()
        zipFiles.forEach(f => zip.file(f.name, f.buffer))
        finalBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
        filename    = `picklist_export_${timestamp}.zip`
        contentType = 'application/zip'

      } else if (csvMode) {
        // single CSV
        finalBuffer = buildCsvBuffer(HEADERS, allRows)
        filename    = `picklist_export_${timestamp}.csv`
        contentType = 'text/csv'

      } else {
        // single_tab or multi_tab Excel
        if (exportMode === 'single_tab') {
          const exportDate = new Date().toLocaleString('en-US', { hour12: false }).replace(',', '')
          const ws = buildPicklistSheet(
            'Salesforce Picklist Export',
            `Objects: ${stats.successfulObjects} | Total Values: ${stats.totalValues} | Global: ${stats.globalPicklistCount || 0} | Export Date: ${exportDate}`,
            allRows
          )
          appendSheet(wb, ws, 'Picklist Data')
        }
        addSummarySheet(wb, buildSummaryRows(stats, modeLabel, session), 'Summary')
        finalBuffer = workbookToBuffer(wb)
        filename    = `picklist_export_${timestamp}.xlsx`
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }

      storeResult(jobId, { buffer: finalBuffer, filename, contentType })
      emit.done(`/api/picklist/download/${jobId}`, stats)
      emit.success(`=== Export complete in ${stats.runtimeFormatted} ===`)

    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') emit.error('Session expired. Please reconnect.')
      else emit.error(`Export failed: ${err.message}`)
    } finally {
      end()
    }
  })()

  return response
}

function buildSummaryRows(stats, modeLabel, session) {
  return [
    ['Picklist Export Summary', ''],
    ['', ''],
    ['Export Mode',             modeLabel],
    ['', ''],
    ['Total Objects Selected',  String(stats.totalObjects)],
    ['Successfully Processed',  String(stats.successfulObjects)],
    ['Failed',                  String(stats.failedObjects)],
    ['No Picklist Fields',      String(stats.objectsNoPicklists)],
    ['', ''],
    ['Total Picklist Fields',   String(stats.totalPicklistFields)],
    ['  incl. Global',          String(stats.globalPicklistCount || 0)],
    ['', ''],
    ['Total Values',            String(stats.totalValues)],
    ['  Active',                String(stats.totalActiveValues)],
    ['  Inactive',              String(stats.totalInactiveValues)],
    ['', ''],
    ['Runtime',                 stats.runtimeFormatted],
    ['Exported At',             new Date().toISOString()],
    ['Org',                     session.instanceUrl?.replace('https://', '')],
  ]
}
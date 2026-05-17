/**
 * Excel file generation using SheetJS (xlsx@0.18.5, MIT licence).
 *
 * Mirrors excel_style_helper.py from the Python app.
 * All functions are server-side only — never imported by client components.
 *
 * NOTE: xlsx@0.18.5 free edition supports cell styles when writing to buffer.
 * Header row uses bold + blue background (Salesforce Lightning blue #0176D3).
 */

import * as XLSX from 'xlsx-js-style'

// Header row visual style — mirrors the Python app's openpyxl header style
const HEADER_FILL  = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
const HEADER_FONT  = { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }
const HEADER_ALIGN = { horizontal: 'left', vertical: 'center', wrapText: false }
const HEADER_BORDER = {
  top:    { style: 'thin', color: { rgb: 'FFFFFF' } },
  bottom: { style: 'thin', color: { rgb: 'FFFFFF' } },
  left:   { style: 'thin', color: { rgb: 'FFFFFF' } },
  right:  { style: 'thin', color: { rgb: 'FFFFFF' } },
}

const DATA_FONT  = { sz: 10 }
const DATA_ALIGN = { vertical: 'top', wrapText: true }

// Title + summary row styles (rows 1 & 2 above column headers)
const TITLE_FILL   = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
const TITLE_FONT   = { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }
const SUMMARY_FILL = { patternType: 'solid', fgColor: { rgb: '1C4587' } }
const SUMMARY_FONT = { color: { rgb: 'FFFFFF' }, sz: 10 }

/**
 * Create a styled worksheet from headers + rows.
 *
 * @param {string[]}   headers   — column header labels
 * @param {string[][]} rows      — data rows (array of string arrays)
 * @param {object}     [opts]
 * @param {boolean}    [opts.wrapText=true]  — wrap long cell text
 * @returns {XLSX.WorkSheet}
 */
export function createStyledSheet(headers, rows, opts = {}) {
  const { wrapText = true, title = '', summaryLine = '' } = opts

  const numCols  = headers.length
  const PAD      = ' '
  const hasTitle = !!(title || summaryLine)

  // Build AOA: optional title + summary rows, then column headers, then data
  const aoa = [
    ...(hasTitle ? [
      [title || 'Salesforce Export', ...Array(numCols - 1).fill(PAD)],
      [summaryLine || '',            ...Array(numCols - 1).fill(PAD)],
    ] : []),
    [...headers],
    ...rows,
  ]

  const ws        = XLSX.utils.aoa_to_sheet(aoa)
  const dataStart = hasTitle ? 3 : 1  // row index where data begins

  if (hasTitle) {
    // Merge title and summary across all columns
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } },
    ]
    // Style title row (row 0)
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: PAD }
      ws[addr].s = { fill: TITLE_FILL, font: TITLE_FONT, alignment: { horizontal: 'left', vertical: 'center' } }
    }
    // Style summary row (row 1)
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: 1, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: PAD }
      ws[addr].s = { fill: SUMMARY_FILL, font: SUMMARY_FONT, alignment: { vertical: 'center' } }
    }
  }

  // Style the header row
  const headerRowIdx = hasTitle ? 2 : 0
  headers.forEach((_, colIdx) => {
    const cellAddr = XLSX.utils.encode_cell({ r: headerRowIdx, c: colIdx })
    if (!ws[cellAddr]) return
    ws[cellAddr].s = {
      fill:      HEADER_FILL,
      font:      HEADER_FONT,
      alignment: HEADER_ALIGN,
      border:    HEADER_BORDER,
    }
  })

  // Style data cells
  rows.forEach((row, rowIdx) => {
    row.forEach((_, colIdx) => {
      const cellAddr = XLSX.utils.encode_cell({ r: rowIdx + dataStart, c: colIdx })
      if (!ws[cellAddr]) return
      ws[cellAddr].s = {
        font:      DATA_FONT,
        alignment: wrapText ? DATA_ALIGN : { vertical: 'top' },
      }
    })
  })

  // Auto column widths — sample up to 500 rows for performance
  const sampleRows = rows.slice(0, 500)
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(
      String(h).length,
      ...sampleRows.map(r => String(r[i] ?? '').split('\n')[0].length)
    )
    return { wch: Math.min(Math.max(maxLen + 2, 8), 80) }
  })

  // Freeze below title+summary+header rows
  const freezeRow = hasTitle ? 3 : 1
  const topLeft   = hasTitle ? 'A4' : 'A2'
  ws['!freeze'] = { xSplit: 0, ySplit: freezeRow, topLeftCell: topLeft, activePane: 'bottomLeft' }

  // Row heights
  ws['!rows'] = [
    ...(hasTitle ? [{ hpt: 24 }, { hpt: 18 }] : []),
    { hpt: 20 },
    ...rows.map(() => ({ hpt: 15 })),
  ]

  return ws
}

/**
 * Create a new workbook and add a styled data sheet.
 *
 * @param {string[]}   headers
 * @param {string[][]} rows
 * @param {string}     [sheetName]
 * @returns {XLSX.WorkBook}
 */
export function createWorkbook(headers, rows, sheetName = 'Export') {
  const wb = XLSX.utils.book_new()
  const ws = createStyledSheet(headers, rows)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

/**
 * Append a summary sheet.
 * Mirrors the *_summary_helper.py modules — two-column key/value layout.
 *
 * @param {XLSX.WorkBook} wb
 * @param {Array<[string, string|number]>} summaryRows   — [[label, value], ...]
 * @param {string}         [sheetName]
 */
export function addSummarySheet(wb, summaryRows, sheetName = 'Summary') {
  const TITLE_FILL   = { patternType: 'solid', fgColor: { rgb: '1C4587' } }
  const TITLE_FONT   = { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }
  const SECTION_FILL = { patternType: 'solid', fgColor: { rgb: '0176D3' } }
  const SECTION_FONT = { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 }
  const LABEL_FONT   = { bold: true, sz: 10 }
  const VALUE_FONT   = { sz: 10 }

  // Use ' ' (space) for empty B column so SheetJS writes the cell and fills show correctly
  const aoa = summaryRows.map(([k, v]) => [String(k), v === '' ? ' ' : String(v)])
  const ws  = XLSX.utils.aoa_to_sheet(aoa)

  summaryRows.forEach(([label, value], i) => {
    const isTitle   = i === 0                       // first row = title
    const isEmpty   = label === '' && value === ''  // spacer row
    const isSection = !isTitle && !isEmpty && value === ''  // section header (label only)

    const cellA = XLSX.utils.encode_cell({ r: i, c: 0 })
    const cellB = XLSX.utils.encode_cell({ r: i, c: 1 })

    if (isTitle) {
      // Merge across both columns — xlsx-js-style correctly fills merged ranges
      if (!ws['!merges']) ws['!merges'] = []
      ws['!merges'].push({ s: { r: i, c: 0 }, e: { r: i, c: 1 } })
      if (!ws[cellA]) ws[cellA] = { t: 's', v: ' ' }
      if (!ws[cellB]) ws[cellB] = { t: 's', v: ' ' }
      ws[cellA].s = { fill: TITLE_FILL, font: TITLE_FONT, alignment: { vertical: 'center' } }
      ws[cellB].s = { fill: TITLE_FILL, font: TITLE_FONT }
    } else if (isSection) {
      if (ws[cellA]) ws[cellA].s = { fill: SECTION_FILL, font: SECTION_FONT, alignment: { vertical: 'center' } }
      if (ws[cellB]) ws[cellB].s = { fill: SECTION_FILL, font: SECTION_FONT }
    } else if (!isEmpty) {
      if (ws[cellA]) ws[cellA].s = { font: LABEL_FONT }
      if (ws[cellB]) ws[cellB].s = { font: VALUE_FONT }
    }
  })

  ws['!cols'] = [{ wch: 36 }, { wch: 24 }]
  ws['!rows'] = summaryRows.map((_, i) => i === 0 ? { hpt: 22 } : { hpt: 16 })
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
}

/**
 * Serialize a workbook to a Node Buffer ready for HTTP response.
 * @param {XLSX.WorkBook} wb
 * @returns {Buffer}
 */
export function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })
}

// ─── Workbook helpers (used by multi-sheet exports in P3/P4) ─────────────────

export function newWorkbook() {
  return XLSX.utils.book_new()
}

export function appendSheet(wb, ws, sheetName) {
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
}

/**
 * Sanitise a name for use as an Excel sheet name.
 * Enforces the 31-char limit and removes invalid characters.
 * Deduplicates by appending _2, _3 etc. when needed.
 *
 * @param {string}  name
 * @param {Set<string>} usedNames   — mutated in-place
 */
export function safeSheetName(name, usedNames = new Set()) {
  let safe = String(name)
    .replace(/[\/\\?\*\[\]:']/g, '_')
    .slice(0, 31)

  if (usedNames.has(safe)) {
    let i = 2
    while (usedNames.has(`${safe.slice(0, 28)}_${i}`)) i++
    safe = `${safe.slice(0, 28)}_${i}`
  }
  usedNames.add(safe)
  return safe
}
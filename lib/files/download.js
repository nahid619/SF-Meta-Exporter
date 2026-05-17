/**
 * HTTP Response helpers for file downloads.
 * Sets the correct Content-Disposition, Content-Type, and Content-Length headers.
 *
 * Mirrors the Python app's file-writing logic — instead of writing to disk with
 * openpyxl.save() or csv.writer(), we stream the buffer directly to the browser.
 */

import { makeTimestamp } from '@/lib/config'

/** Replace `{timestamp}` in a filename template with the current timestamp */
function stampFilename(template) {
  return template.replace('{timestamp}', makeTimestamp())
}

/**
 * Build a download Response from a raw Buffer.
 *
 * @param {Buffer}  buffer
 * @param {string}  filename     — final filename the browser saves as
 * @param {string}  contentType
 */
export function fileResponse(buffer, filename, contentType) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length':      String(buffer.byteLength ?? buffer.length),
      'Cache-Control':       'no-store',
    },
  })
}

/**
 * Download response for an Excel (.xlsx) file.
 * @param {Buffer} buffer
 * @param {string} filenameTemplate   — e.g. 'Picklist_Export_{timestamp}.xlsx'
 */
export function excelDownload(buffer, filenameTemplate) {
  return fileResponse(
    buffer,
    stampFilename(filenameTemplate),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}

/**
 * Download response for a CSV file.
 * @param {string|Buffer} content
 * @param {string} filenameTemplate
 */
export function csvDownload(content, filenameTemplate) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  return fileResponse(buffer, stampFilename(filenameTemplate), 'text/csv; charset=utf-8')
}

/**
 * Download response for a ZIP file.
 * @param {Buffer} buffer
 * @param {string} filenameTemplate
 */
export function zipDownload(buffer, filenameTemplate) {
  return fileResponse(buffer, stampFilename(filenameTemplate), 'application/zip')
}

/**
 * Stream a ReadableStream directly as a download.
 * Used for large ZIP files (ContentDocument) — avoids buffering everything in memory.
 *
 * @param {ReadableStream} stream
 * @param {string}         filename
 * @param {string}         contentType
 */
export function streamDownload(stream, filename, contentType) {
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control':       'no-store',
      'Transfer-Encoding':   'chunked',
    },
  })
}

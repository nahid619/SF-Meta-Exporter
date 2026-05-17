/**
 * CSV generation — server-side only.
 * Proper RFC 4180 escaping: commas, double-quotes, and newlines in cells
 * are all handled correctly. Output uses \r\n line endings per the spec.
 *
 * Mirrors the CSV output format from the Python app's content_document_exporter.py.
 */

/**
 * Escape a single cell value for CSV.
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 */
function escapeCell(val) {
  const s = val == null ? '' : String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Convert headers + rows to a CSV string.
 * Returns a string — use Buffer.from(str, 'utf-8') when building a Response.
 *
 * @param {string[]}   headers
 * @param {string[][]} rows
 * @returns {string}
 */
export function rowsToCSV(headers, rows) {
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map(row => row.map(escapeCell).join(',')),
  ]
  return lines.join('\r\n') + '\r\n'
}

/**
 * Stream-friendly CSV generator.
 * Accepts an async generator that yields rows one at a time.
 * Useful for very large exports (ContentDocument, SOQL results).
 *
 * @param {string[]} headers
 * @param {AsyncIterable<string[]>} rowGenerator
 * @returns {ReadableStream<Uint8Array>}
 *
 * Usage in a route handler:
 *   async function* generateRows() {
 *     for (const record of records) yield [record.Id, record.Name]
 *   }
 *   return new Response(streamCSV(headers, generateRows()), { headers: csvHeaders })
 */
export function streamCSV(headers, rowGenerator) {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      // Emit header row
      controller.enqueue(encoder.encode(headers.map(escapeCell).join(',') + '\r\n'))

      // Emit data rows one at a time
      for await (const row of rowGenerator) {
        controller.enqueue(encoder.encode(row.map(escapeCell).join(',') + '\r\n'))
      }

      controller.close()
    },
  })
}

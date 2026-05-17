/**
 * Server-Sent Events (SSE) streaming infrastructure.
 *
 * Replaces the status_callback / threading_helper.py pattern from the Python app.
 * Instead of calling a GUI callback on the main thread, we push SSE events
 * down a streaming HTTP response.
 *
 * Usage in a route handler:
 *
 *   export async function POST(request) {
 *     const { response, emit, end } = createSSEStream()
 *
 *     // Run async work in the background — do NOT await it here,
 *     // or the response will never be returned to the client.
 *     ;(async () => {
 *       try {
 *         emit.info('Starting export…')
 *         emit.progress(10, 'Processing Account…')
 *         // ... do work ...
 *         emit.done('/api/picklist/download/job_123', { totalFields: 42 })
 *       } catch (err) {
 *         emit.error(err.message)
 *       } finally {
 *         end()
 *       }
 *     })()
 *
 *     return response   // ← stream starts flowing immediately
 *   }
 *
 * On the client, subscribe with fetch() + ReadableStream (see hooks/useExport.js).
 * We use fetch rather than EventSource because EventSource only supports GET.
 */

import { formatRuntime } from '@/lib/config'

export function createSSEStream() {
  let controller

  const stream = new ReadableStream({
    start(c) { controller = c },
    cancel()  { /* client disconnected */ },
  })

  const response = new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      // Disable nginx / Vercel Edge buffering so events arrive immediately
      'X-Accel-Buffering': 'no',
    },
  })

  const encoder = new TextEncoder()

  /** Push a raw event object down the stream */
  function push(data) {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch {
      // Stream already closed (client disconnected) — ignore
    }
  }

  /** Close the stream */
  function end() {
    try { controller.close() } catch {}
  }

  /**
   * Convenience emitters — mirrors the message types in the Python status log.
   *
   *   emit.info('Fetching objects…')
   *   emit.success('Account exported successfully')
   *   emit.warn('Skipping deprecated field')
   *   emit.error('Object not found in org')
   *   emit.progress(42, 'Processing Contact…', '00:01:30')
   *   emit.done('/api/picklist/download/abc123', { totalFields: 100 })
   */
  const emit = {
    info(message) {
      push({ type: 'info', message })
    },
    success(message) {
      push({ type: 'success', message })
    },
    warn(message) {
      push({ type: 'warn', message })
    },
    error(message) {
      push({ type: 'error', message })
    },
    /**
     * @param {number} percent       0–100
     * @param {string} [message]     optional status line
     * @param {number} [elapsedSecs] used to compute ETA
     */
    progress(percent, message = '', elapsedSecs = 0) {
      const eta = percent > 0 && percent < 100 && elapsedSecs > 0
        ? formatRuntime(elapsedSecs / percent * (100 - percent))
        : ''
      push({ type: 'progress', percent, message, eta })
    },
    /**
     * Signal that the export finished.
     * @param {string} downloadUrl   e.g. '/api/picklist/download/job_abc'
     * @param {object} [stats]       arbitrary stats object shown in StatsSummary
     */
    done(downloadUrl, stats = null) {
      push({ type: 'done', downloadUrl, stats })
    },
    /** Push any arbitrary payload — used by Phase 7 switch loader */
    data(payload) {
      push(payload)
    },
  }

  return { response, emit, end }
}

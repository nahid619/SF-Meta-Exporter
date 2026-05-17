'use client'

/**
 * useExport — the client-side engine for all export modules.
 *
 * Replaces the Python app's ThreadHelper + status_callback pattern.
 * Instead of background threads posting to a GUI queue, we:
 *   1. POST to a module API route (which returns an SSE stream)
 *   2. Read the stream with fetch() + ReadableStream
 *   3. Parse SSE events and update local + global log state
 *
 * Why fetch() instead of EventSource:
 *   EventSource only supports GET requests. Our export endpoints are POST
 *   (they receive the object list / config in the body), so we read the
 *   streaming response body directly.
 *
 * Usage in a module page:
 *
 *   const { isRunning, progress, downloadUrl, stats, startExport, cancel } = useExport()
 *
 *   function handleExport() {
 *     startExport('/api/picklist/export', { objects: selectedObjects })
 *   }
 */

import { useState, useCallback, useRef } from 'react'
import { useExportContext } from '@/components/ExportProvider'

export function useExport() {
  const { addLog, clearLogs } = useExportContext()

  const [isRunning,    setIsRunning]    = useState(false)
  const [progress,     setProgress]     = useState(null)   // { percent, eta, message }
  const [downloadUrl,  setDownloadUrl]  = useState(null)   // '/api/.../download/job_xxx'
  const [stats,        setStats]        = useState(null)   // module-specific stats object
  const [error,        setError]        = useState(null)   // last error string

  const abortRef = useRef(null)

  // Internal: push to both local error state AND global log
  function log(type, message) {
    addLog(type, message)
    if (type === 'error') setError(message)
  }

  /**
   * Start an export by POSTing to `url` with `body`.
   * The route handler returns a streaming SSE response.
   *
   * @param {string} url    — e.g. '/api/picklist/export'
   * @param {object} body   — JSON body: { objects, format, ... }
   */
  const startExport = useCallback(async (url, body = {}) => {
    // Reset all state
    clearLogs()
    setIsRunning(true)
    setProgress(null)
    setDownloadUrl(null)
    setStats(null)
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      })

      if (!res.ok) {
        // Non-streaming error response
        const data = await res.json().catch(() => ({}))
        log('error', data.error || `Server error: HTTP ${res.status}`)
        return
      }

      // Read the SSE stream
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buf     = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })

        // SSE events are separated by blank lines (\n\n)
        const blocks = buf.split('\n\n')
        buf = blocks.pop() // keep any incomplete trailing chunk

        for (const block of blocks) {
          // Each block is "data: <json>" (we don't use event: or id: fields)
          const dataLine = block.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue

          let evt
          try {
            evt = JSON.parse(dataLine.slice(6)) // strip 'data: '
          } catch {
            continue
          }

          switch (evt.type) {
            case 'info':
            case 'warn':
              log(evt.type, evt.message)
              break

            case 'success':
              log('success', evt.message)
              break

            case 'error':
              log('error', evt.message)
              break

            case 'progress':
              setProgress({ percent: evt.percent ?? 0, eta: evt.eta ?? '', message: evt.message ?? '' })
              if (evt.message) log('info', evt.message)
              break

            case 'done':
              setDownloadUrl(evt.downloadUrl)
              setStats(evt.stats ?? null)
              log('success', evt.message || '✓ Export complete!')
              setProgress({ percent: 100, eta: '', message: 'Done' })
              break
          }
        }
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        log('warn', '⚠ Export cancelled.')
      } else {
        log('error', err.message || 'Unexpected network error.')
      }
    } finally {
      setIsRunning(false)
      abortRef.current = null
    }
  }, [addLog, clearLogs])

  /** Cancel the in-flight export */
  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    isRunning,
    progress,
    downloadUrl,
    stats,
    error,
    startExport,
    cancel,
  }
}

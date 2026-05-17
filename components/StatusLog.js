'use client'

import { useEffect, useRef, useState } from 'react'
import { useExportContext } from '@/components/ExportProvider'

/**
 * StatusLog — scrolling log panel at the bottom of the dashboard.
 *
 * Phase 2 change: reads log lines from ExportContext instead of props.
 * Any module page that calls useExport() will have its log lines appear here
 * automatically, since useExport() pushes to the same context.
 *
 * Behaviour mirrors the Python app's status log:
 *   - Auto-scrolls to bottom on new messages
 *   - Stops auto-scrolling if the user manually scrolls up
 *   - Colour-coded: info=dim, success=green, error=red, warn=amber
 *   - Auto-expands when the first log line of a new export arrives
 */

const PREFIX = { info: '›', success: '✓', error: '✗', warn: '⚠' }

export default function StatusLog() {
  const { logs } = useExportContext()

  const [open, setOpen]               = useState(false)
  const [userScrolled, setUserScrolled] = useState(false)
  const bodyRef = useRef(null)
  const prevLen = useRef(0)

  // Auto-open when new logs arrive after being empty
  useEffect(() => {
    if (logs.length > 0 && prevLen.current === 0) {
      setOpen(true)
      setUserScrolled(false)
    }
    prevLen.current = logs.length
  }, [logs.length])

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (!open || userScrolled) return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, open, userScrolled])

  function handleScroll() {
    const el = bodyRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    setUserScrolled(!atBottom)
  }

  const lastLine = logs[logs.length - 1]

  return (
    <div className="status-log-bar">
      <button
        className="status-log-toggle"
        onClick={() => { setOpen(o => !o); setUserScrolled(false) }}
        aria-expanded={open}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
          {open ? '▾' : '▸'}
        </span>
        <span>Status Log</span>

        {/* Last message preview (collapsed state) */}
        {!open && lastLine && (
          <span className={`log-line ${lastLine.type}`} style={{
            marginLeft: '8px',
            maxWidth: '500px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
            fontSize: '11.5px',
          }}>
            {PREFIX[lastLine.type] ?? '›'} {lastLine.message}
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)' }}>
          {logs.length > 0 ? `${logs.length} line${logs.length !== 1 ? 's' : ''}` : 'empty'}
        </span>
      </button>

      {open && (
        <div
          className="status-log-body"
          ref={bodyRef}
          onScroll={handleScroll}
        >
          {logs.length === 0 ? (
            <span className="log-line info" style={{ opacity: 0.4 }}>
              No output yet. Run an export to see progress here.
            </span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={`log-line ${line.type || 'info'}`}>
                <span style={{ color: 'var(--text-3)', marginRight: '10px', userSelect: 'none' }}>
                  {String(i + 1).padStart(3, ' ')}
                </span>
                {PREFIX[line.type] ?? '›'} {line.message}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

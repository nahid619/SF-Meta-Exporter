'use client'

import { createContext, useContext, useState, useCallback } from 'react'

/**
 * ExportContext — shared state between:
 *   - Module pages (they push log lines via addLog)
 *   - StatusLog    (it reads all lines from context)
 *
 * Why context and not prop-drilling:
 *   The StatusLog lives in app/dashboard/layout.js, but the module pages
 *   that produce log lines are nested in {children}. They can't directly
 *   pass props up to the layout's StatusLog — context solves this cleanly.
 */

const ExportContext = createContext(null)

export function ExportProvider({ children }) {
  const [logs, setLogs] = useState([])

  /** Append a single log line */
  const addLog = useCallback((type, message) => {
    setLogs(prev => [...prev, { type, message, ts: Date.now() }])
  }, [])

  /** Clear all log lines (called at start of each new export) */
  const clearLogs = useCallback(() => setLogs([]), [])

  return (
    <ExportContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </ExportContext.Provider>
  )
}

/** Hook — use inside any client component inside DashboardLayout */
export function useExportContext() {
  const ctx = useContext(ExportContext)
  if (!ctx) {
    throw new Error('useExportContext must be used inside <ExportProvider>')
  }
  return ctx
}

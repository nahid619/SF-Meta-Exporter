// app/dashboard/backup/page.js

/**
 * Backup & Restore — module 7.
 *
 * Two tabs share this page:
 *
 *   ↓ Backup
 *     Select Salesforce objects → query all records → build ZIP of CSVs
 *     + metadata.json → download.
 *
 *   ↑ Restore
 *     Upload a backup ZIP → parse client-side with JSZip → preview objects
 *     and record counts → POST parsed data to /api/backup/restore → SSE
 *     progress → completion stats (no download; records live in Salesforce).
 *
 * Both tabs share a single useExport() instance so the Status Log always
 * reflects the most recent operation. Switching tabs while an operation is
 * running is disabled to prevent accidental state resets.
 */

'use client'

import { useState, useRef, useCallback } from 'react'
import ObjectSelector from '@/components/ObjectSelector'
import ExportButton   from '@/components/ExportButton'
import ProgressBar    from '@/components/ProgressBar'
import DownloadButton from '@/components/DownloadButton'
import StatsSummary   from '@/components/StatsSummary'
import { useExport }  from '@/hooks/useExport'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtDate(isoString) {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

// ─── Restore: ZIP drop zone ───────────────────────────────────────────────────

function DropZone({ onFile, disabled }) {
  const inputRef  = useRef(null)
  const [drag, setDrag] = useState(false)

  function handleDrop(e) {
    e.preventDefault()
    setDrag(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  function handleChange(e) {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''   // allow re-picking the same file
  }

  return (
    <div
      onDragEnter={e => { e.preventDefault(); if (!disabled) setDrag(true) }}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        padding: '28px 16px',
        border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border-hi)'}`,
        borderRadius: 'var(--radius-sm)',
        background: drag ? 'var(--accent-dim)' : 'var(--bg-input)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'center',
        transition: 'border-color 0.15s, background 0.15s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '8px' }}>📦</div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '4px' }}>
        Drop backup ZIP here
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--text-3)' }}>
        or click to browse — select a <code style={{ fontFamily: 'var(--font-mono)' }}>backup_*.zip</code> file
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}

// ─── Restore: backup preview card ────────────────────────────────────────────

function BackupPreview({ meta, csvData }) {
  if (!meta) return null

  const objects     = Object.entries(meta.objects || {})
  const totalRecords = objects.reduce((s, [, o]) => s + (o.record_count || 0), 0)

  return (
    <div style={{ marginTop: '14px' }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
        borderBottom: 'none',
      }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-hi)', marginBottom: '4px' }}>
          Backup Preview
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '11.5px', color: 'var(--text-2)' }}>
          <span>📅 {fmtDate(meta.created_at)}</span>
          <span>🌐 {meta.org_instance?.replace('https://', '') || '—'}</span>
          <span>📦 {objects.length} object{objects.length !== 1 ? 's' : ''}</span>
          <span>📝 {totalRecords.toLocaleString()} records</span>
        </div>
      </div>

      {/* Object list */}
      <div style={{
        maxHeight: '200px',
        overflowY: 'auto',
        border: '1px solid var(--border-hi)',
        borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
      }}>
        {objects.map(([name, info], idx) => {
          const hasCsv = !!csvData?.[name]
          return (
            <div
              key={name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 12px',
                background: idx % 2 === 0 ? 'var(--bg-dark)' : 'var(--bg-card)',
                borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                fontSize: '12px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: hasCsv ? 'var(--green)' : 'var(--amber)', fontSize: '10px' }}>
                  {hasCsv ? '✓' : '⚠'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}>{name}</span>
              </span>
              <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                {(info.record_count ?? 0).toLocaleString()} rec · {info.fields?.length ?? 0} fields
              </span>
            </div>
          )
        })}
      </div>

      {/* Warning if large */}
      {totalRecords > 50_000 && (
        <div style={{
          marginTop: '8px', padding: '7px 10px',
          background: 'rgba(245,158,11,0.08)', border: '1px solid var(--amber)',
          borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#fcd34d',
        }}>
          ⚠ Large backup ({totalRecords.toLocaleString()} records). If restore fails with a request size
          error, see the size limit note in <code style={{ fontFamily: 'var(--font-mono)' }}>app/api/backup/restore/route.js</code>.
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BackupRestorePage() {
  // Tab state
  const [activeTab, setActiveTab] = useState('backup')

  // Backup tab
  const [selectedObjects, setSelectedObjects] = useState([])

  // Restore tab
  const [zipFile,     setZipFile]     = useState(null)   // File object
  const [backupMeta,  setBackupMeta]  = useState(null)   // parsed metadata.json
  const [csvData,     setCsvData]     = useState(null)   // { ObjectName: "csv text" }
  const [parseError,  setParseError]  = useState(null)
  const [isParsing,   setIsParsing]   = useState(false)

  // Shared export engine — both tabs push to the same SSE consumer and
  // Status Log so the user always sees the most recent operation's output.
  const { isRunning, progress, downloadUrl, stats, error, startExport, cancel } = useExport()

  const hasActivity = isRunning || progress !== null || downloadUrl !== undefined || error

  // ── Parse ZIP client-side when the user picks a file ─────────────────────
  const handleZipSelect = useCallback(async (file) => {
    setZipFile(file)
    setBackupMeta(null)
    setCsvData(null)
    setParseError(null)
    setIsParsing(true)

    try {
      // Dynamic import keeps JSZip out of the initial page bundle
      const JSZip = (await import('jszip')).default
      const buf   = await file.arrayBuffer()
      const zip   = await JSZip.loadAsync(buf)

      // Require metadata.json
      const metaEntry = zip.file('metadata.json')
      if (!metaEntry) {
        throw new Error('Invalid backup ZIP: metadata.json not found. Make sure this is a file created by the Backup module.')
      }

      const meta = JSON.parse(await metaEntry.async('string'))
      if (!meta.objects || typeof meta.objects !== 'object') {
        throw new Error('metadata.json is malformed: missing "objects" key.')
      }

      // Read every CSV whose name matches an object in metadata
      const data = {}
      for (const objName of Object.keys(meta.objects)) {
        const csvEntry = zip.file(`${objName}.csv`)
        if (csvEntry) {
          data[objName] = await csvEntry.async('string')
        }
      }

      setBackupMeta(meta)
      setCsvData(data)
    } catch (err) {
      setParseError(err.message)
    } finally {
      setIsParsing(false)
    }
  }, [])

  // ── Run backup ────────────────────────────────────────────────────────────
  function handleBackup() {
    if (!selectedObjects.length || isRunning) return
    startExport('/api/backup/export', { objects: selectedObjects })
  }

  // ── Run restore ───────────────────────────────────────────────────────────
  function handleRestore() {
    if (!backupMeta || !csvData || isRunning) return
    startExport('/api/backup/restore', { metadata: backupMeta, csvData })
  }

  // ── Derived labels ────────────────────────────────────────────────────────
  const restoreObjectCount = Object.keys(csvData || {}).length
  const backupButtonLabel  = selectedObjects.length
    ? `Backup ${selectedObjects.length} Object${selectedObjects.length !== 1 ? 's' : ''}`
    : 'Select objects first'
  const restoreButtonLabel = backupMeta
    ? `Restore ${restoreObjectCount} Object${restoreObjectCount !== 1 ? 's' : ''} into Org`
    : 'Load a backup ZIP first'

  // ── Panel label for results area ──────────────────────────────────────────
  const statsTitle = activeTab === 'backup' ? 'Backup Summary' : 'Restore Summary'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── TITLE BAR ────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '14px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-dark)',
        gap: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>🔁</span>
          <h1 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
            Backup &amp; Restore
          </h1>
        </div>

        <div style={{
          width: '1px', height: '36px',
          background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
          margin: '0 20px', flexShrink: 0,
          boxShadow: '0 0 8px var(--accent)',
        }} />

        <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, maxWidth: '580px' }}>
          Backup selected Salesforce objects to a ZIP of CSV files, then restore them
          into any connected org. Dependency order is resolved automatically.
        </p>
      </div>

      {/* ── 3-PANEL MAIN AREA ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── PANEL 1: Configuration (62%) ─────────────────────────────── */}
        <div style={{
          width: '62%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>

          {/* Tab switcher */}
          <div style={{
            flexShrink: 0,
            display: 'flex', gap: '6px',
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            {[
              { id: 'backup',  label: '↓ Backup',  title: 'Export org data to a downloadable ZIP' },
              { id: 'restore', label: '↑ Restore', title: 'Import records from a backup ZIP' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => !isRunning && setActiveTab(tab.id)}
                disabled={isRunning}
                title={tab.title}
                style={{
                  flex: 1, padding: '7px 0',
                  fontSize: '12.5px', fontWeight: 600,
                  fontFamily: 'var(--font-outfit)',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${activeTab === tab.id ? 'var(--accent)' : 'var(--border-hi)'}`,
                  background: activeTab === tab.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                  color: activeTab === tab.id ? '#bfdbfe' : 'var(--text-3)',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Backup tab: object selector ─────────────────────────────── */}
          {activeTab === 'backup' && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <ObjectSelector
                selected={selectedObjects}
                onChange={setSelectedObjects}
                disabled={isRunning}
                fillHeight
              />
            </div>
          )}

          {/* ── Restore tab: ZIP upload + preview ───────────────────────── */}
          {activeTab === 'restore' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>

              <DropZone onFile={handleZipSelect} disabled={isRunning || isParsing} />

              {/* Parsing indicator */}
              {isParsing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12px', color: 'var(--text-3)' }}>
                  <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
                  Reading backup ZIP…
                </div>
              )}

              {/* Parse error */}
              {parseError && (
                <div className="form-error" style={{ marginTop: '10px' }}>
                  ⚠ {parseError}
                </div>
              )}

              {/* Selected file name */}
              {zipFile && !isParsing && !parseError && (
                <div style={{
                  marginTop: '10px', padding: '6px 10px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-hi)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  fontSize: '11.5px', color: 'var(--text-2)',
                }}>
                  <span style={{ color: 'var(--green)', fontSize: '12px' }}>✓</span>
                  <span style={{ fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {zipFile.name}
                  </span>
                  <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                    {fmtBytes(zipFile.size)}
                  </span>
                </div>
              )}

              {/* Backup preview */}
              <BackupPreview meta={backupMeta} csvData={csvData} />

              {/* Restore notice */}
              {backupMeta && (
                <div style={{
                  marginTop: '10px', padding: '8px 10px',
                  background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#93c5fd',
                  lineHeight: 1.5,
                }}>
                  ℹ New records will be created in the currently connected org. The original
                  Salesforce IDs are not preserved — look-up field values pointing to other
                  records may need adjustment.
                </div>
              )}
            </div>
          )}

          {/* ── Bottom action area ───────────────────────────────────────── */}
          <div style={{
            flexShrink: 0,
            padding: '14px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            {activeTab === 'backup' ? (
              <ExportButton
                onClick={handleBackup}
                isRunning={isRunning}
                disabled={!selectedObjects.length}
                label={backupButtonLabel}
                runningLabel="Backing up…"
                onCancel={cancel}
              />
            ) : (
              <ExportButton
                onClick={handleRestore}
                isRunning={isRunning}
                disabled={!backupMeta || !csvData || isParsing}
                label={restoreButtonLabel}
                runningLabel="Restoring…"
                onCancel={cancel}
              />
            )}
          </div>
        </div>

        {/* ── PANEL 2: Progress + results (38%) ────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 20px' }}>

            {/* Idle placeholder */}
            {!hasActivity && (
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                height: '100%', gap: '12px',
              }}>
                <span style={{ fontSize: '40px' }}>🔁</span>
                <p style={{ fontSize: '12px', color: 'var(--text-1)', textAlign: 'center', lineHeight: 1.7, maxWidth: '280px' }}>
                  {activeTab === 'backup'
                    ? 'Select objects on the left, then click Backup to export them as a ZIP of CSV files.'
                    : 'Drop a backup ZIP on the left, review the preview, then click Restore to import.'}
                </p>
              </div>
            )}

            {/* Progress */}
            {(isRunning || progress) && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
                  {activeTab === 'backup' ? 'Backup Progress' : 'Restore Progress'}
                </div>
                <ProgressBar progress={progress} isRunning={isRunning} />
              </div>
            )}

            {/* Error */}
            {error && !isRunning && (
              <div className="form-error" style={{ marginBottom: '16px' }}>
                ⚠ {error}
              </div>
            )}

            {/* Results */}
            {!isRunning && stats && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '4px' }}>
                  Results
                </div>
                <ProgressBar progress={progress} isRunning={false} />
                <StatsSummary stats={stats} title={statsTitle} />

                {/* Download button — only for backup (restore has no output file) */}
                {downloadUrl && (
                  <DownloadButton
                    url={downloadUrl}
                    label="Download Backup ZIP"
                  />
                )}

                {/* Restore success note */}
                {activeTab === 'restore' && !downloadUrl && stats.successfulObjects > 0 && (
                  <div style={{
                    marginTop: '14px', padding: '10px 12px',
                    background: 'var(--green-dim)', border: '1px solid var(--green)',
                    borderRadius: 'var(--radius-sm)', fontSize: '12px', color: '#6ee7b7',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <span style={{ fontSize: '16px' }}>✓</span>
                    Restore complete — check your Salesforce org to verify the imported records.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: '7px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-dark)',
        display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
        fontSize: '11px', color: 'var(--text-3)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
          📦 <strong>Backup format:</strong> ZIP of CSVs + metadata.json
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
          🔀 <strong>Restore order:</strong> dependency-sorted (Kahn&apos;s algorithm)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
          🔒 <strong>Insert only:</strong> createable fields · 200 records/batch
        </span>
      </div>

    </div>
  )
}

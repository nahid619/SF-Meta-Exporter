// FILE PATH: app/dashboard/files/page.js
'use client'

/**
 * File Downloader page — supports two independent exports:
 *
 *   1. ContentDocument / ContentVersion  (modern Salesforce Files)
 *      → POST /api/content/export
 *      → ZIP contains: Files/ + file_manifest.csv
 *
 *   2. Legacy Attachment (classic Salesforce Attachments)
 *      → POST /api/attachment/export  (only when checkbox is checked)
 *      → ZIP contains: Attachments/ + attachment_manifest.csv
 *
 * The two exports are independent — each has its own SSE stream,
 * progress display, and download button. The attachment export is opt-in
 * (default unchecked) because Attachment is a legacy object.
 */

import { useState, useCallback, useRef } from 'react'
import ExportButton  from '@/components/ExportButton'
import ProgressBar   from '@/components/ProgressBar'
import StatsSummary  from '@/components/StatsSummary'
import { useExport } from '@/hooks/useExport'

// ── Shared inline-download helper ─────────────────────────────────────────────

function triggerInlineDownload(downloadUrl, stats, defaultFilename) {
  if (!downloadUrl) return
  try {
    const a      = document.createElement('a')
    a.href       = downloadUrl  // always a data: URI from the SSE zipBase64 field
    a.download   = stats?._filename || defaultFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch (err) {
    alert(`Download error: ${err.message}`)
  }
}

// ── Small reusable download-result card ───────────────────────────────────────

function DownloadCard({ downloadUrl, stats, progress, defaultFilename, label, manifestName }) {
  if (!downloadUrl) return null
  return (
    <>
      <ProgressBar progress={progress} isRunning={false} />
      <StatsSummary stats={stats} title={`${label} Summary`} />
      <button
        type="button"
        onClick={() => triggerInlineDownload(downloadUrl, stats, defaultFilename)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          width: '100%', marginTop: '12px', padding: '12px',
          background: 'var(--green-dim)', border: '1px solid var(--green)',
          borderRadius: 'var(--radius-sm)', color: '#6ee7b7',
          fontSize: '14px', fontWeight: 500, fontFamily: 'var(--font-outfit)',
          cursor: 'pointer', transition: 'background 0.2s',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download {label} ZIP
      </button>
      <p style={{ marginTop: '8px', fontSize: '11.5px', color: '#8b949e', textAlign: 'center' }}>
        ZIP contains{' '}
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hi)' }}>
          {label === 'Files' ? 'Files/' : 'Attachments/'}
        </code>{' '}
        folder +{' '}
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hi)' }}>
          {manifestName}
        </code>
      </p>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FileDownloaderPage() {
  const [latestOnly,          setLatestOnly]          = useState(false)
  const [includeAttachments,  setIncludeAttachments]  = useState(false)
  const [maxConcurrent,       setMaxConcurrent]       = useState(10)

  // Two independent export hooks — one per download type
  const files       = useExport()   // ContentDocument export
  const attachments = useExport()   // Attachment export

  // Both exports run sequentially when the user clicks Start Download:
  // files first, then attachments (if opted in). We track an "orchestrating"
  // flag so the button shows a loading state for the full duration.
  const [isOrchestrating, setIsOrchestrating] = useState(false)
  const cancelRef = useRef(false)

  async function handleExport() {
    cancelRef.current = false
    setIsOrchestrating(true)

    try {
      // Always export ContentDocuments (Files)
      await files.startExport('/api/content/export', { latestOnly, maxConcurrent })

      // Export legacy Attachments only when the checkbox is checked
      if (includeAttachments && !cancelRef.current) {
        await attachments.startExport('/api/attachment/export', { maxConcurrent })
      }
    } finally {
      setIsOrchestrating(false)
    }
  }

  function handleCancel() {
    cancelRef.current = true
    files.cancel()
    attachments.cancel()
  }

  const isRunning     = isOrchestrating || files.isRunning || attachments.isRunning
  const filesActivity = files.isRunning || files.progress || files.downloadUrl || files.error
  const attActivity   = attachments.isRunning || attachments.progress || attachments.downloadUrl || attachments.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── FIXED TITLE BAR ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '14px 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-dark)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>📁</span>
          <h1 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
            File Downloader
          </h1>
        </div>
        <div style={{
          width: '1px', height: '36px', flexShrink: 0, margin: '0 20px',
          background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
          boxShadow: '0 0 8px var(--accent)',
        }} />
        <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, maxWidth: '580px' }}>
          Bulk-download Salesforce Files (ContentDocument) and optionally legacy Attachments.
          Each export produces a separate ZIP with a DataLoader-compatible CSV manifest.
        </p>
      </div>

      {/* ── 2-PANEL MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── LEFT PANEL: Options ── */}
        <div style={{
          width: '50%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>
          {/* Panel header */}
          <div style={{
            flexShrink: 0, padding: '12px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Download Options
            </span>
          </div>

          {/* Scrollable options body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Section label — Files */}
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent-hi)', marginBottom: '8px' }}>
              📄 Salesforce Files (ContentDocument)
            </div>

            {/* Latest-only toggle */}
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '12px 14px', marginBottom: '12px',
              background: 'var(--bg-input)',
              border: `1px solid ${latestOnly ? 'var(--accent)' : 'var(--border-hi)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              transition: 'border-color 0.15s',
            }}>
              <input
                type="checkbox" checked={latestOnly}
                onChange={e => setLatestOnly(e.target.checked)}
                disabled={isRunning}
                style={{ marginTop: '2px', accentColor: 'var(--accent)', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: '13px', color: '#c9d1d9', fontWeight: 500 }}>Latest version only</div>
                <div style={{ fontSize: '11.5px', color: '#8b949e', marginTop: '3px', lineHeight: 1.5 }}>
                  Download only the most recent version of each file. Faster and produces a smaller ZIP.
                </div>
              </div>
            </label>

            {/* Divider */}
            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 14px' }} />

            {/* Section label — Attachments */}
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
              🗂 Legacy Attachments
            </div>

            {/* Include attachments checkbox */}
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '12px 14px', marginBottom: '12px',
              background: 'var(--bg-input)',
              border: `1px solid ${includeAttachments ? 'var(--amber)' : 'var(--border-hi)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              transition: 'border-color 0.15s',
            }}>
              <input
                type="checkbox" checked={includeAttachments}
                onChange={e => setIncludeAttachments(e.target.checked)}
                disabled={isRunning}
                style={{ marginTop: '2px', accentColor: '#f59e0b', flexShrink: 0 }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', color: '#c9d1d9', fontWeight: 500 }}>Include legacy attachments</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: '#92400e', background: '#78350f33', border: '1px solid #92400e',
                    borderRadius: '3px', padding: '1px 5px',
                  }}>Legacy</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#8b949e', marginTop: '3px', lineHeight: 1.5 }}>
                  Also download the classic Salesforce <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>Attachment</code> object.
                  Produces a second ZIP with an <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>attachment_manifest.csv</code>.
                  Most orgs migrated these to Files — only enable if you know your org still has them.
                </div>
              </div>
            </label>

            {/* Divider */}
            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 14px' }} />

            {/* Concurrency slider */}
            <div style={{
              padding: '14px', background: 'var(--bg-input)',
              border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)',
              marginBottom: '14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', color: '#c9d1d9', fontWeight: 500 }}>Concurrent Downloads</span>
                <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent-hi)' }}>
                  {maxConcurrent}
                </span>
              </div>
              <input
                type="range" min="1" max="20" step="1"
                value={maxConcurrent}
                onChange={e => setMaxConcurrent(Number(e.target.value))}
                disabled={isRunning}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: isRunning ? 'not-allowed' : 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#8b949e', marginTop: '6px' }}>
                <span>1 — safe</span>
                <span>10 — default</span>
                <span>20 — max</span>
              </div>
              <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px' }}>
                Applies to both exports when legacy attachments are included.
              </div>
            </div>

            {/* Output info */}
            <div style={{
              padding: '12px 14px', background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              marginBottom: '14px', fontSize: '12.5px', color: '#8b949e', lineHeight: 1.7,
            }}>
              <div style={{ color: '#c9d1d9', fontWeight: 500, marginBottom: '6px' }}>📦 Output ZIPs contain:</div>
              <div style={{ paddingLeft: '8px' }}>
                <div>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)' }}>Files/</code>
                  {' '}— all downloaded ContentDocument files
                </div>
                <div>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)' }}>file_manifest.csv</code>
                  {' '}— DataLoader-ready CSV for Files
                </div>
                {includeAttachments && (
                  <>
                    <div style={{ marginTop: '4px', borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#f59e0b' }}>Attachments/</code>
                      {' '}— all downloaded legacy attachment bodies
                    </div>
                    <div>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#f59e0b' }}>attachment_manifest.csv</code>
                      {' '}— DataLoader-ready CSV for Attachments
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quick reference */}
            <div style={{
              padding: '12px 14px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: '11.5px', lineHeight: 1.7,
            }}>
              {[
                { icon: '📋', label: 'Files filename',       val: '{Title}_{DocId}_v{Version}.{ext}' },
                { icon: '📋', label: 'Attachment filename',  val: '{AttachmentId}_{Name}' },
                { icon: '🔄', label: 'Retry',                val: '3 attempts with back-off per file' },
                { icon: '📊', label: 'Files CSV columns',    val: 'Title, DocId, Version, LinkedObjects, Size…' },
                { icon: '📊', label: 'Attachments CSV',      val: 'Id, Name, ParentId, ParentType, ContentType…' },
                { icon: '⚠',  label: 'Large orgs',           val: '>500 MB may need chunked exports' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span>{item.icon}</span>
                  <div>
                    <strong style={{ color: '#c9d1d9' }}>{item.label}:</strong>{' '}
                    <span style={{ color: '#8b949e' }}>{item.val}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Export button — pinned to bottom */}
          <div style={{
            flexShrink: 0, padding: '14px 16px',
            borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <ExportButton
              onClick={handleExport}
              isRunning={isRunning}
              label={includeAttachments ? 'Start Download (Files + Attachments)' : 'Start Download'}
              runningLabel={files.isRunning ? 'Downloading Files…' : attachments.isRunning ? 'Downloading Attachments…' : 'Downloading…'}
              onCancel={handleCancel}
            />
          </div>
        </div>

        {/* ── RIGHT PANEL: Progress & Results ── */}
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Panel header */}
          <div style={{
            flexShrink: 0, padding: '12px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Download Progress
            </span>
            {isRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent-hi)' }}>
                <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderTopColor: 'var(--accent-hi)', borderColor: 'rgba(59,130,246,0.3)' }} />
                {files.isRunning ? 'Downloading Files…' : 'Downloading Attachments…'}
              </div>
            )}
          </div>

          {/* Scrollable progress body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Idle state */}
            {!filesActivity && !attActivity && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', textAlign: 'center' }}>
                <span style={{ fontSize: '40px' }}>📁</span>
                <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.6, maxWidth: '280px' }}>
                  Configure options on the left and click <strong>Start Download</strong> to begin.
                  Per-file progress streams here in real time.
                </p>
              </div>
            )}

            {/* ── Files section ── */}
            {filesActivity && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{
                  fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
                  color: 'var(--accent-hi)', marginBottom: '10px',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  <span>📄</span> Salesforce Files
                  {files.isRunning && (
                    <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '2px', borderTopColor: 'var(--accent-hi)', borderColor: 'rgba(59,130,246,0.3)', marginLeft: '4px' }} />
                  )}
                </div>

                {(files.isRunning || files.progress) && (
                  <div style={{ marginBottom: '10px' }}>
                    <ProgressBar progress={files.progress} isRunning={files.isRunning} />
                    {files.stats?.successfulDownloads != null && (
                      <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                        {[
                          { label: 'Downloaded', value: files.stats.successfulDownloads,  color: 'var(--green)' },
                          { label: 'Failed',     value: files.stats.failedDownloads,       color: files.stats.failedDownloads > 0 ? 'var(--red)' : '#8b949e' },
                          { label: 'Size (MB)',  value: (files.stats.totalSizeBytes / 1024 / 1024).toFixed(1), color: '#c9d1d9' },
                        ].map(s => (
                          <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {files.error && !files.isRunning && (
                  <div className="form-error" style={{ marginBottom: '10px' }}>⚠ {files.error}</div>
                )}

                <DownloadCard
                  downloadUrl={files.downloadUrl}
                  stats={files.stats}
                  progress={files.progress}
                  defaultFilename="ContentDocument_Export.zip"
                  label="Files"
                  manifestName="file_manifest.csv"
                />
              </div>
            )}

            {/* Divider between the two result sections */}
            {filesActivity && attActivity && (
              <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 16px' }} />
            )}

            {/* ── Attachments section ── */}
            {attActivity && (
              <div>
                <div style={{
                  fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
                  color: '#f59e0b', marginBottom: '10px',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  <span>🗂</span> Legacy Attachments
                  {attachments.isRunning && (
                    <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '2px', borderTopColor: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)', marginLeft: '4px' }} />
                  )}
                </div>

                {(attachments.isRunning || attachments.progress) && (
                  <div style={{ marginBottom: '10px' }}>
                    <ProgressBar progress={attachments.progress} isRunning={attachments.isRunning} />
                    {attachments.stats?.successfulDownloads != null && (
                      <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                        {[
                          { label: 'Downloaded', value: attachments.stats.successfulDownloads,  color: 'var(--green)' },
                          { label: 'Failed',     value: attachments.stats.failedDownloads,       color: attachments.stats.failedDownloads > 0 ? 'var(--red)' : '#8b949e' },
                          { label: 'Size (MB)',  value: (attachments.stats.totalSizeBytes / 1024 / 1024).toFixed(1), color: '#c9d1d9' },
                        ].map(s => (
                          <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {attachments.error && !attachments.isRunning && (
                  <div className="form-error" style={{ marginBottom: '10px' }}>⚠ {attachments.error}</div>
                )}

                <DownloadCard
                  downloadUrl={attachments.downloadUrl}
                  stats={attachments.stats}
                  progress={attachments.progress}
                  defaultFilename="Attachment_Export.zip"
                  label="Attachments"
                  manifestName="attachment_manifest.csv"
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
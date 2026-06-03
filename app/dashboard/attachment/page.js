// FILE PATH: app/dashboard/attachment/page.js
'use client'

import { useState }     from 'react'
import ObjectSelector   from '@/components/ObjectSelector'
import ExportButton     from '@/components/ExportButton'
import ProgressBar      from '@/components/ProgressBar'
import StatsSummary     from '@/components/StatsSummary'
import { useExport }    from '@/hooks/useExport'

// ── Inline download helper (same pattern as files page) ───────────────────────

function triggerInlineDownload(downloadUrl, stats) {
  if (!downloadUrl) return
  try {
    const a    = document.createElement('a')
    a.href     = downloadUrl
    a.download = stats?._filename || 'Attachment_Export.zip'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch (err) {
    alert(`Download error: ${err.message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AttachmentDownloaderPage() {
  const [selected,      setSelected]      = useState([])
  const [maxConcurrent, setMaxConcurrent] = useState(10)

  const { isRunning, progress, downloadUrl, stats, error, startExport, cancel } = useExport()

  function handleExport() {
    if (!selected.length) return
    startExport('/api/attachment/export', { objects: selected, maxConcurrent })
  }

  const hasActivity = isRunning || progress || downloadUrl || error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── FIXED TITLE BAR ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '14px 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-dark)', gap: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>🗂</span>
          <h1 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
            Attachment Downloader
          </h1>
        </div>
        <div style={{
          width: '1px', height: '36px', flexShrink: 0, margin: '0 20px',
          background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
          boxShadow: '0 0 8px var(--accent)',
        }} />
        <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, maxWidth: '580px' }}>
          Download legacy Salesforce <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>Attachment</code> records
          by parent object. Select one or more objects and only those attachments are downloaded —
          no unnecessary data. Output is a ZIP with an <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>attachment_manifest.csv</code>.
        </p>
      </div>

      {/* ── 3-PANEL MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── PANEL 1: Object selector (40%) ── */}
        <div style={{
          width: '40%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ObjectSelector
              selected={selected}
              onChange={setSelected}
              disabled={isRunning}
              fillHeight
            />
          </div>

          {/* Concurrency + export button pinned to bottom */}
          <div style={{
            flexShrink: 0, padding: '14px 16px',
            borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            {/* Concurrency slider */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#c9d1d9', fontWeight: 500 }}>Concurrent Downloads</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--accent-hi)' }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#8b949e', marginTop: '4px' }}>
                <span>1 — safe</span><span>10 — default</span><span>20 — max</span>
              </div>
            </div>

            <ExportButton
              onClick={handleExport}
              isRunning={isRunning}
              disabled={!selected.length}
              label={selected.length > 0
                ? `Download Attachments (${selected.length} object${selected.length !== 1 ? 's' : ''})`
                : 'Download Attachments (select objects)'}
              runningLabel="Downloading…"
              onCancel={cancel}
            />
            {!isRunning && selected.length === 0 && (
              <p style={{ marginTop: '7px', fontSize: '11.5px', color: 'var(--text-3)', textAlign: 'center' }}>
                Select at least one object above
              </p>
            )}
          </div>
        </div>

        {/* ── PANEL 2: Selected objects (20%) ── */}
        <div style={{
          width: '20%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>
          <div style={{
            flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Selected Objects
            </span>
            {selected.length > 0 && (
              <span style={{
                background: 'var(--accent-dim)', border: '1px solid rgba(56,139,253,0.3)',
                borderRadius: '20px', padding: '2px 10px',
                fontSize: '11px', color: 'var(--accent-hi)',
              }}>
                {selected.length}
              </span>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}>
            {selected.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: '8px',
                color: 'var(--text-2)', textAlign: 'center',
              }}>
                <span style={{ fontSize: '28px' }}>🗂</span>
                <p style={{ fontSize: '12px', lineHeight: 1.5 }}>
                  Pick objects on the left — only attachments on those parent records will be downloaded.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {selected.map(obj => (
                  <div key={obj} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: '12.5px', color: 'var(--text-1)', fontFamily: 'var(--font-outfit)' }}>
                      {obj}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelected(selected.filter(o => o !== obj))}
                      disabled={isRunning}
                      style={{
                        background: 'none', border: 'none', padding: '2px 4px',
                        cursor: isRunning ? 'not-allowed' : 'pointer',
                        color: 'var(--text-3)', fontSize: '14px', lineHeight: 1,
                        borderRadius: '3px',
                      }}
                      title="Remove"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info card pinned to bottom of panel 2 */}
          {selected.length > 0 && (
            <div style={{
              flexShrink: 0, margin: '0 12px 12px',
              padding: '10px 12px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: '11.5px', color: '#8b949e', lineHeight: 1.6,
            }}>
              <div style={{ color: '#c9d1d9', fontWeight: 500, marginBottom: '4px' }}>📦 Output ZIP:</div>
              <div><code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)' }}>Attachments/</code> — files</div>
              <div><code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)' }}>attachment_manifest.csv</code></div>
            </div>
          )}
        </div>

        {/* ── PANEL 3: Progress + results (40%) ── */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Download Progress
            </span>
            {isRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent-hi)' }}>
                <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderTopColor: 'var(--accent-hi)', borderColor: 'rgba(59,130,246,0.3)' }} />
                Downloading…
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Idle */}
            {!hasActivity && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: '12px', textAlign: 'center',
              }}>
                <span style={{ fontSize: '40px' }}>🗂</span>
                <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.6, maxWidth: '260px' }}>
                  Select objects on the left and click <strong>Download Attachments</strong> to begin.
                  Per-object progress streams here in real time.
                </p>
              </div>
            )}

            {/* Live progress */}
            {(isRunning || progress) && (
              <div style={{ marginBottom: '16px' }}>
                <ProgressBar progress={progress} isRunning={isRunning} />

                {/* Per-object live stats */}
                {stats?.objectResults?.length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
                      Per-Object Progress
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {stats.objectResults.map(r => (
                        <div key={r.objectName} style={{
                          padding: '8px 12px',
                          background: 'var(--bg-input)', border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                            <span style={{ fontSize: '12.5px', color: 'var(--text-1)', fontFamily: 'var(--font-outfit)', fontWeight: 500 }}>
                              {r.objectName}
                            </span>
                            <span style={{ fontSize: '11px', color: r.done ? (r.failed > 0 ? 'var(--amber)' : 'var(--green)') : 'var(--accent-hi)', fontFamily: 'var(--font-mono)' }}>
                              {r.done ? (r.failed > 0 ? '⚠ Done' : '✓ Done') : '⟳ Running'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#8b949e' }}>
                            <span>Found: <strong style={{ color: '#c9d1d9' }}>{r.found ?? '…'}</strong></span>
                            <span style={{ color: '#6ee7b7' }}>↓ {r.downloaded ?? 0}</span>
                            {r.failed > 0 && <span style={{ color: '#fca5a5' }}>✗ {r.failed}</span>}
                            {r.sizeMb != null && <span>{r.sizeMb} MB</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Running totals */}
                {stats?.successfulDownloads != null && (
                  <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                    {[
                      { label: 'Downloaded', value: stats.successfulDownloads, color: 'var(--green)' },
                      { label: 'Failed',     value: stats.failedDownloads,     color: stats.failedDownloads > 0 ? 'var(--red)' : '#8b949e' },
                      { label: 'Size (MB)',  value: (stats.totalSizeBytes / 1024 / 1024).toFixed(1), color: '#c9d1d9' },
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

            {/* Error */}
            {error && !isRunning && (
              <div className="form-error" style={{ marginBottom: '12px' }}>⚠ {error}</div>
            )}

            {/* Results */}
            {!isRunning && downloadUrl && (
              <>
                <ProgressBar progress={progress} isRunning={false} />
                <StatsSummary stats={stats} title="Attachment Download Summary" />

                {/* Per-object final breakdown */}
                {stats?.objectResults?.length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
                      Per-Object Results
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {stats.objectResults.map(r => (
                        <div key={r.objectName} style={{
                          padding: '7px 12px',
                          background: 'var(--bg-input)',
                          border: `1px solid ${r.failed > 0 ? 'var(--amber)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                          <span style={{ fontSize: '12.5px', color: 'var(--text-1)', fontFamily: 'var(--font-outfit)' }}>
                            {r.objectName}
                          </span>
                          <div style={{ display: 'flex', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: '#6ee7b7' }}>↓ {r.downloaded}</span>
                            {r.failed > 0 && <span style={{ color: '#fcd34d' }}>✗ {r.failed}</span>}
                            <span style={{ color: '#8b949e' }}>{r.sizeMb} MB</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => triggerInlineDownload(downloadUrl, stats)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    width: '100%', marginTop: '14px', padding: '12px',
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
                  Download Attachments ZIP
                </button>
                <p style={{ marginTop: '8px', fontSize: '11.5px', color: '#8b949e', textAlign: 'center' }}>
                  ZIP contains <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hi)' }}>Attachments/</code> folder + <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hi)' }}>attachment_manifest.csv</code>
                </p>
              </>
            )}
          </div>
        </div>

      </div>

      {/* ── FIXED STATUS FOOTER ── */}
      <div style={{
        flexShrink: 0, padding: '7px 20px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-dark)', display: 'flex', alignItems: 'center',
        gap: '14px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-3)',
      }}>
        {[
          { icon: '🔗', text: <><strong>1-to-1</strong> — each Attachment belongs to exactly one parent record</> },
          { icon: '📋', text: <><strong>18 CSV columns</strong> — Id, Name, ParentId, ParentType, ContentType, size, dates…</> },
          { icon: '🏷',  text: <><strong>Filename format:</strong> Name_Id.ext</> },
          { icon: '🔄', text: <><strong>Retry:</strong> 3 attempts with back-off per file</> },
        ].map((item, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
            {item.icon} {item.text}
          </span>
        ))}
      </div>

    </div>
  )
}
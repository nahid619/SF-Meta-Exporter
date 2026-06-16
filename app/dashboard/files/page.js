// FILE PATH: app/dashboard/files/page.js
'use client'

import { useState }     from 'react'
import ExportButton     from '@/components/ExportButton'
import ProgressBar      from '@/components/ProgressBar'
import StatsSummary     from '@/components/StatsSummary'
import { useExport }    from '@/hooks/useExport'

// ── Filter helpers ────────────────────────────────────────────────────────────

const EMPTY_FILTERS = {
  created_from:   '',
  created_to:     '',
  modified_from:  '',
  modified_to:    '',
  file_type:      '',
  file_extension: '',
  title:          '',
  is_archived:    'any',   // 'any' | 'true' | 'false'
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Returns an error string if any filled date field is malformed, otherwise ''. */
function validateFilters(f) {
  const dateFields = [
    { key: 'created_from',  label: 'Created From'   },
    { key: 'created_to',    label: 'Created To'     },
    { key: 'modified_from', label: 'Modified From'  },
    { key: 'modified_to',   label: 'Modified To'    },
  ]
  for (const { key, label } of dateFields) {
    if (f[key] && !DATE_RE.test(f[key])) {
      return `${label} must be YYYY-MM-DD`
    }
  }
  return ''
}

/** Count how many filters are meaningfully set (used for the badge). */
function countActiveFilters(f) {
  return [
    f.created_from, f.created_to,
    f.modified_from, f.modified_to,
    f.file_type, f.file_extension, f.title,
  ].filter(Boolean).length + (f.is_archived !== 'any' ? 1 : 0)
}

// ── Shared input style (keeps JSX lean) ──────────────────────────────────────

const inputStyle = {
  width:        '100%',
  padding:      '8px 10px',
  background:   'var(--bg-input)',
  border:       '1px solid var(--border-hi)',
  borderRadius: 'var(--radius-sm)',
  color:        'var(--text-1)',
  fontFamily:   'var(--font-mono)',
  fontSize:     '12px',
  outline:      'none',
}

// ─────────────────────────────────────────────────────────────────────────────

export default function FileDownloaderPage() {
  const [latestOnly,     setLatestOnly]     = useState(false)
  const [maxConcurrent,  setMaxConcurrent]  = useState(10)

  // filter panel
  const [filtersOpen,    setFiltersOpen]    = useState(false)
  const [filters,        setFilters]        = useState(EMPTY_FILTERS)
  const [filterError,    setFilterError]    = useState('')

  const { isRunning, progress, downloadUrl, stats, error, startExport, cancel } = useExport()

  const activeCount = countActiveFilters(filters)

  function setFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
    setFilterError('')
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setFilterError('')
  }

  function handleExport() {
    const err = validateFilters(filters)
    if (err) { setFilterError(err); setFiltersOpen(true); return }

    // Strip empty / default values before sending — mirrors Python behaviour
    const activeFilters = {}
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== 'any') activeFilters[k] = v
    }

    startExport('/api/content/export', { latestOnly, maxConcurrent, filters: activeFilters })
  }

  const hasActivity = isRunning || progress || downloadUrl || error

  function handleDownload() {
    if (!downloadUrl) return
    try {
      const a      = document.createElement('a')
      a.href       = downloadUrl
      a.download   = stats?._filename || 'ContentDocument_Export.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      alert(`Download error: ${err.message}`)
    }
  }

  // ── Filter section label styles ───────────────────────────────────────────

  const filterLabelStyle = {
    display:       'block',
    fontSize:      '11px',
    fontWeight:    600,
    color:         'var(--text-3)',
    marginBottom:  '5px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  }

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
        <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, maxWidth: '560px' }}>
          Bulk-download all ContentDocuments from your org. Files are packed into a
          ZIP archive with a DataLoader-compatible <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>file_manifest.csv</code>.
          Supports all versions or latest-only with configurable concurrency.
        </p>
      </div>

      {/* ── 2-PANEL MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── LEFT PANEL: Options (50%) ── */}
        <div style={{
          width: '50%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>
          <div style={{
            flexShrink: 0, padding: '12px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Download Options
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

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
            </div>

            {/* ── FILTERS SECTION ───────────────────────────────────────── */}
            <div style={{
              background: 'var(--bg-input)',
              border: `1px solid ${activeCount > 0 ? 'var(--accent)' : 'var(--border-hi)'}`,
              borderRadius: 'var(--radius-sm)',
              marginBottom: '14px',
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}>

              {/* Filter toggle header */}
              <button
                type="button"
                onClick={() => setFiltersOpen(o => !o)}
                disabled={isRunning}
                style={{
                  width:      '100%',
                  display:    'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding:    '11px 14px',
                  background: 'transparent',
                  border:     'none',
                  cursor:     isRunning ? 'not-allowed' : 'pointer',
                  color:      'var(--text-1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px' }}>🔍</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#c9d1d9' }}>Filters</span>
                  {activeCount > 0 && (
                    <span style={{
                      fontSize:     '10px',
                      fontWeight:   700,
                      background:   'var(--accent)',
                      color:        '#fff',
                      borderRadius: '10px',
                      padding:      '1px 7px',
                    }}>
                      {activeCount} active
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activeCount > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); clearFilters() }}
                      onKeyDown={e => e.key === 'Enter' && (e.stopPropagation(), clearFilters())}
                      style={{
                        fontSize:   '11px',
                        color:      '#8b949e',
                        cursor:     'pointer',
                        padding:    '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        border:     '1px solid var(--border)',
                      }}
                    >
                      Clear all
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: 'var(--text-3)', transform: filtersOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                </div>
              </button>

              {/* Collapsible body */}
              {filtersOpen && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>

                  {/* Validation error */}
                  {filterError && (
                    <div style={{ marginTop: '10px', padding: '8px 10px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.4)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: '#fca5a5' }}>
                      ⚠ {filterError}
                    </div>
                  )}

                  {/* Created Date range */}
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Created Date
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={filterLabelStyle}>From</label>
                        <input
                          type="date"
                          value={filters.created_from}
                          onChange={e => setFilter('created_from', e.target.value)}
                          disabled={isRunning}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={filterLabelStyle}>To</label>
                        <input
                          type="date"
                          value={filters.created_to}
                          onChange={e => setFilter('created_to', e.target.value)}
                          disabled={isRunning}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Last Modified Date range */}
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Last Modified Date
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={filterLabelStyle}>From</label>
                        <input
                          type="date"
                          value={filters.modified_from}
                          onChange={e => setFilter('modified_from', e.target.value)}
                          disabled={isRunning}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={filterLabelStyle}>To</label>
                        <input
                          type="date"
                          value={filters.modified_to}
                          onChange={e => setFilter('modified_to', e.target.value)}
                          disabled={isRunning}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Text filters: FileType + FileExtension */}
                  <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={filterLabelStyle}>File Type</label>
                      <input
                        type="text"
                        placeholder="e.g. PDF"
                        value={filters.file_type}
                        onChange={e => setFilter('file_type', e.target.value)}
                        disabled={isRunning}
                        className="field-input"
                        style={{ ...inputStyle, padding: '8px 10px' }}
                      />
                      <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '4px' }}>Partial match (LIKE)</div>
                    </div>
                    <div>
                      <label style={filterLabelStyle}>File Extension</label>
                      <input
                        type="text"
                        placeholder="e.g. pdf"
                        value={filters.file_extension}
                        onChange={e => setFilter('file_extension', e.target.value)}
                        disabled={isRunning}
                        className="field-input"
                        style={{ ...inputStyle, padding: '8px 10px' }}
                      />
                      <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '4px' }}>Partial match (LIKE)</div>
                    </div>
                  </div>

                  {/* Title text filter */}
                  <div style={{ marginTop: '12px' }}>
                    <label style={filterLabelStyle}>Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Invoice"
                      value={filters.title}
                      onChange={e => setFilter('title', e.target.value)}
                      disabled={isRunning}
                      className="field-input"
                      style={{ ...inputStyle, padding: '8px 10px' }}
                    />
                    <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '4px' }}>Partial match — searches ContentDocument.Title</div>
                  </div>

                  {/* IsArchived dropdown */}
                  <div style={{ marginTop: '12px' }}>
                    <label style={filterLabelStyle}>IsArchived</label>
                    <select
                      value={filters.is_archived}
                      onChange={e => setFilter('is_archived', e.target.value)}
                      disabled={isRunning}
                      style={{
                        ...inputStyle,
                        padding: '8px 10px',
                        cursor:  isRunning ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <option value="any">Any</option>
                      <option value="true">Archived only</option>
                      <option value="false">Not archived</option>
                    </select>
                  </div>

                </div>
              )}
            </div>
            {/* ── END FILTERS SECTION ───────────────────────────────────── */}

            {/* Output info */}
            <div style={{
              padding: '12px 14px', background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              marginBottom: '14px', fontSize: '12.5px', color: '#8b949e', lineHeight: 1.7,
            }}>
              <div style={{ color: '#c9d1d9', fontWeight: 500, marginBottom: '6px' }}>📦 Output ZIP contains:</div>
              <div style={{ paddingLeft: '8px' }}>
                <div>• <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)' }}>Files/</code> — all downloaded file versions</div>
                <div>• <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)' }}>file_manifest.csv</code> — DataLoader-ready CSV</div>
              </div>
            </div>

            {/* Quick reference */}
            <div style={{
              padding: '12px 14px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: '11.5px', lineHeight: 1.7,
            }}>
              {[
                { icon: '📋', label: 'Filename format', val: '{Title}_{DocId}_v{Version}.{ext}' },
                { icon: '🔄', label: 'Retry',           val: '3 attempts with back-off per file' },
                { icon: '📊', label: 'CSV columns',     val: 'Title, DocId, Version, LinkedObjects, Size…' },
                { icon: '⚠',  label: 'Large orgs',      val: '>500 MB may need chunked exports' },
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

          {/* Export button pinned to bottom */}
          <div style={{
            flexShrink: 0, padding: '14px 16px',
            borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <ExportButton
              onClick={handleExport}
              isRunning={isRunning}
              label="Start Download"
              runningLabel="Downloading…"
              onCancel={cancel}
            />
          </div>
        </div>

        {/* ── RIGHT PANEL: Progress & Results (50%) ── */}
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                Downloading…
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Idle */}
            {!hasActivity && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', textAlign: 'center' }}>
                <span style={{ fontSize: '40px' }}>📁</span>
                <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.6, maxWidth: '280px' }}>
                  Configure options on the left and click <strong>Start Download</strong> to begin.
                  Per-file progress streams here in real time.
                </p>
              </div>
            )}

            {/* Live progress */}
            {(isRunning || progress) && (
              <div style={{ marginBottom: '16px' }}>
                <ProgressBar progress={progress} isRunning={isRunning} />
                {stats?.successfulDownloads != null && (
                  <div style={{ marginTop: '14px', display: 'flex', gap: '10px' }}>
                    {[
                      { label: 'Downloaded', value: stats.successfulDownloads,  color: 'var(--green)' },
                      { label: 'Failed',     value: stats.failedDownloads,       color: stats.failedDownloads > 0 ? 'var(--red)' : '#8b949e' },
                      { label: 'Size (MB)',  value: (stats.totalSizeBytes / 1024 / 1024).toFixed(1), color: '#c9d1d9' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '10px 8px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '3px' }}>{s.label}</div>
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
                <StatsSummary stats={stats} title="Download Summary" />
                <button
                  type="button"
                  onClick={handleDownload}
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
                  Download ZIP Archive
                </button>
                <p style={{ marginTop: '8px', fontSize: '11.5px', color: '#8b949e', textAlign: 'center' }}>
                  ZIP contains <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hi)' }}>Files/</code> folder + <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hi)' }}>file_manifest.csv</code>
                </p>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

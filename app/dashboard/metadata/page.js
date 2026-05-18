'use client'

import { useState } from 'react'
import ObjectSelector from '@/components/ObjectSelector'
import ExportButton   from '@/components/ExportButton'
import ProgressBar    from '@/components/ProgressBar'
import DownloadButton from '@/components/DownloadButton'
import StatsSummary   from '@/components/StatsSummary'
import { useExport }  from '@/hooks/useExport'

export default function MetadataExporterPage() {
  const [selected,            setSelected]            = useState([])
  const [exportMode,          setExportMode]          = useState('multi_tab')
  const [csvMode,             setCsvMode]             = useState(false)
  const [includeDescriptions, setIncludeDescriptions] = useState(true)
  const [includeFieldUsage,   setIncludeFieldUsage]   = useState(false)

  const { isRunning, progress, downloadUrl, stats, error, startExport, cancel } = useExport()

  function handleExport() {
    if (!selected.length) return
    startExport('/api/metadata/export', { objects: selected, includeDescriptions, includeFieldUsage, exportMode, csvMode })
  }

  const hasActivity = isRunning || progress || downloadUrl || error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── FIXED TITLE BAR ─────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '14px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-dark)',
        gap: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>🔍</span>
          <h1 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
            Metadata Exporter
          </h1>
        </div>

        {/* Glowing divider */}
        <div style={{
          width: '1px', height: '36px',
          background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
          margin: '0 20px', flexShrink: 0,
          boxShadow: '0 0 8px var(--accent)',
        }} />

        <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, maxWidth: '560px' }}>
          Export complete field metadata across 15 columns — one sheet per object.
          Optionally includes field descriptions (via Tooling API) and field usage
          tracking across 9 metadata sources.
        </p>
      </div>

      {/* ── 3-PANEL MAIN AREA ───────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── PANEL 1: Objects (40%) ── */}
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

          {/* Options + export button pinned to bottom */}
          <div style={{
            flexShrink: 0,
            padding: '14px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
              Options
            </div>
            {/* Options — horizontal row, wraps to vertical on narrow screens */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
              {[
                {
                  key: 'desc',
                  checked: includeDescriptions,
                  onChange: setIncludeDescriptions,
                  label: 'Field Descriptions',
                  sub: 'Fetches Description + Track History via Tooling API',
                  warn: false,
                },
                {
                  key: 'usage',
                  checked: includeFieldUsage,
                  onChange: setIncludeFieldUsage,
                  label: 'Field Usage',
                  sub: includeFieldUsage
                    ? '⚠ ~30–90 sec per object for large orgs'
                    : 'Queries 9 sources: Layouts, VRs, Flows, Apex, VF…',
                  warn: true,
                },
              ].map(opt => (
                <label key={opt.key} style={{
                  flex: '1 1 140px',
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '8px 10px',
                  background: 'var(--bg-input)',
                  border: `1px solid ${opt.checked ? 'var(--accent)' : 'var(--border-hi)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  opacity: isRunning ? 0.6 : 1,
                  transition: 'border-color 0.15s',
                  minWidth: 0,
                }}>
                  <input
                    type="checkbox"
                    checked={opt.checked}
                    onChange={e => opt.onChange(e.target.checked)}
                    disabled={isRunning}
                    style={{ marginTop: '2px', accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Include {opt.label}</div>
                    <div style={{ fontSize: '10.5px', color: opt.warn && opt.checked ? 'var(--amber)' : '#8b949e', marginTop: '2px', lineHeight: 1.4 }}>
                      {opt.sub}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <ExportButton
              onClick={handleExport}
              isRunning={isRunning}
              disabled={!selected.length}
              label={`Export ${selected.length > 0 ? `${selected.length} Object${selected.length !== 1 ? 's' : ''}` : '(select objects)'}`}
              runningLabel={includeFieldUsage ? 'Exporting (field usage enabled)…' : 'Exporting…'}
              onCancel={cancel}
            />
            {!isRunning && selected.length === 0 && (
              <p style={{ marginTop: '7px', fontSize: '11.5px', color: 'var(--text-3)', textAlign: 'center' }}>
                Select at least one object above
              </p>
            )}
          </div>
        </div>

        {/* ── PANEL 2: Selected for Export (30%) ── */}
        <div style={{
          width: '20%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>
          <div style={{ flexShrink: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>

            {/* Selected count row */}
            <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Selected for Export
              </span>
              {selected.length > 0 && (
                <span style={{ background: 'var(--accent-dim)', border: '1px solid rgba(56,139,253,0.3)', borderRadius: '20px', padding: '2px 10px', fontSize: '11px', color: 'var(--accent-hi)' }}>
                  {selected.length} {selected.length === 1 ? 'object' : 'objects'}
                </span>
              )}
            </div>

            {/* Export Format + CSV toggle */}
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '7px' }}>
                Export Format
              </div>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '7px' }}>
                {[
                  { value: 'multi_tab',  label: 'Multi-Tab',  sub: 'Tabs per object', disabledWhenCsv: true },
                  { value: 'multi_file', label: 'Multi-File', sub: 'ZIP per object' },
                ].map(opt => {
                  const isDisabled = isRunning || (csvMode && opt.disabledWhenCsv)
                  return (
                    <button
                      key={opt.value} type="button"
                      className={`seg-btn ${exportMode === opt.value && !isDisabled ? 'active' : ''}`}
                      onClick={() => { if (!isDisabled) setExportMode(opt.value) }}
                      disabled={isDisabled}
                      title={csvMode && opt.disabledWhenCsv ? 'Not available in CSV mode' : ''}
                      style={{ flex: 1, flexDirection: 'column', gap: '1px', paddingTop: '6px', paddingBottom: '6px', opacity: isDisabled ? 0.35 : 1 }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '11px' }}>{opt.label}</span>
                      <span style={{ fontSize: '9.5px', opacity: 0.75 }}>{opt.sub}</span>
                    </button>
                  )
                })}
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px',
                background: csvMode ? 'rgba(56,139,253,0.08)' : 'var(--bg-input)',
                border: `1px solid ${csvMode ? 'var(--accent)' : 'var(--border-hi)'}`,
                borderRadius: 'var(--radius-sm)', cursor: isRunning ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}>
                <input type="checkbox" checked={csvMode} onChange={e => {
                  setCsvMode(e.target.checked)
                  if (e.target.checked && exportMode === 'multi_tab') setExportMode('multi_file')
                }} disabled={isRunning} style={{ accentColor: 'var(--accent)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '11.5px', color: csvMode ? '#bfdbfe' : '#c9d1d9', fontWeight: 500 }}>CSV Mode</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>.csv output · Multi-Tab disabled</div>
                </div>
              </label>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}>
            {selected.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%',
                gap: '8px', color: 'var(--text-2)', textAlign: 'center',
              }}>
                <span style={{ fontSize: '28px' }}>📋</span>
                <p style={{ fontSize: '12px', lineHeight: 1.5 }}>
                  Click objects in the left panel to add them here.
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
        </div>

        {/* ── PANEL 3: Export Progress (30%) ── */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Export Progress
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Field usage warning */}
            {includeFieldUsage && !isRunning && !downloadUrl && (
              <div style={{
                marginBottom: '12px', padding: '10px 14px',
                background: 'rgba(245,158,11,0.08)', border: '1px solid var(--amber)',
                borderRadius: 'var(--radius-sm)', fontSize: '12px', color: '#fcd34d', lineHeight: 1.5,
              }}>
                ⚠ Field usage tracking enabled. Expect 30–90 seconds per object for large orgs.
              </div>
            )}

            {/* Idle state */}
            {!hasActivity && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%',
                gap: '10px',
              }}>
                <span style={{ fontSize: '36px' }}>🔍</span>
                <p style={{ fontSize: '12px', color: 'var(--text-1)', textAlign: 'center', lineHeight: 1.6 }}>
                  Select objects and click Export.<br />
                  Progress streams here in real time.
                </p>
              </div>
            )}

            {/* Progress bars */}
            {(isRunning || progress) && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
                  Overall
                </div>
                <ProgressBar progress={progress} isRunning={isRunning} />
              </div>
            )}

            {/* Error */}
            {error && !isRunning && (
              <div className="form-error" style={{ marginBottom: '12px' }}>
                ⚠ {error}
              </div>
            )}

            {/* Results */}
            {!isRunning && downloadUrl && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '4px' }}>
                  Results
                </div>
                <ProgressBar progress={progress} isRunning={false} />
                <StatsSummary stats={stats} title="Metadata Export Summary" />
                <DownloadButton
                  url={downloadUrl}
                  label={
                    exportMode === 'multi_file'
                      ? `Download ZIP Archive (${csvMode ? 'CSV files' : 'Excel files'})`
                      : csvMode
                        ? 'Download CSV File'
                        : 'Download Excel File (.xlsx)'
                  }
                />
              </>
            )}
          </div>
        </div>

      </div>

      {/* ── FIXED STATUS FOOTER ─────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: '7px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-dark)',
        display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
        fontSize: '11px', color: 'var(--text-3)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
          📌 <strong>15 columns:</strong> Object · Field Label · API Name · Data Type · Length · Field Type · Required · Picklist Values · Formula · External ID · Track History · Description · Help Text · Attributes · Field Usage
        </span>
      </div>

    </div>
  )
}
'use client'

import { useState } from 'react'
import ObjectSelector from '@/components/ObjectSelector'
import ExportButton   from '@/components/ExportButton'
import ProgressBar    from '@/components/ProgressBar'
import DownloadButton from '@/components/DownloadButton'
import StatsSummary   from '@/components/StatsSummary'
import { useExport }  from '@/hooks/useExport'

export default function PicklistExporterPage() {
  const [selected,   setSelected]   = useState([])
  const [exportMode, setExportMode] = useState('single_tab')

  const { isRunning, progress, downloadUrl, stats, error, startExport, cancel } = useExport()

  function handleExport() {
    if (!selected.length) return
    startExport('/api/picklist/export', { objects: selected, exportMode })
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
          <span style={{ fontSize: '22px' }}>📊</span>
          <h1 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
            Picklist Exporter
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
          Export all picklist and multi-select picklist fields — including active and inactive values,
          Global Value Set detection, and a per-object summary. Outputs a styled .xlsx file.
        </p>
      </div>

      {/* ── 3-PANEL MAIN AREA ───────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── PANEL 1: Objects (40%) ── */}
        <div style={{
          width: '40%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>
          {/* ObjectSelector fills the scrollable body */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ObjectSelector
              selected={selected}
              onChange={setSelected}
              disabled={isRunning}
              fillHeight
            />
          </div>

          {/* Format toggle + export button pinned to bottom of panel 1 */}
          <div style={{
            flexShrink: 0,
            padding: '14px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
              Export Format
            </div>
            <div className="seg-control" style={{ marginBottom: '12px' }}>
              {[
                { value: 'single_tab', label: 'Single Tab',  sub: 'All in one sheet' },
                { value: 'multi_tab',  label: 'Multi-Tab',   sub: 'Sheet per object' },
              ].map(opt => (
                <button
                  key={opt.value} type="button"
                  className={`seg-btn ${exportMode === opt.value ? 'active' : ''}`}
                  onClick={() => setExportMode(opt.value)}
                  disabled={isRunning}
                  style={{ flexDirection: 'column', gap: '2px', paddingTop: '7px', paddingBottom: '7px' }}
                >
                  <span style={{ fontWeight: 600 }}>{opt.label}</span>
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>{opt.sub}</span>
                </button>
              ))}
            </div>

            <ExportButton
              onClick={handleExport}
              isRunning={isRunning}
              disabled={!selected.length}
              label={`Export ${selected.length > 0 ? `${selected.length} Object${selected.length !== 1 ? 's' : ''}` : '(select objects)'}`}
              runningLabel="Exporting…"
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
          {/* Header */}
          <div style={{
            flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Selected for Export
            </span>
            {selected.length > 0 && (
              <span style={{
                background: 'var(--accent-dim)', border: '1px solid rgba(56,139,253,0.3)',
                borderRadius: '20px', padding: '2px 10px',
                fontSize: '11px', color: 'var(--accent-hi)',
              }}>
                {selected.length} {selected.length === 1 ? 'object' : 'objects'}
              </span>
            )}
          </div>

          {/* Scrollable selected list */}
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
          {/* Header */}
          <div style={{
            flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Export Progress
            </span>
          </div>

          {/* Scrollable progress body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Idle state */}
            {!hasActivity && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%',
                gap: '10px',
              }}>
                <span style={{ fontSize: '36px' }}>📊</span>
                <p style={{ fontSize: '12px', color: 'var(--text-1)', textAlign: 'center', lineHeight: 1.6 }}>
                  Select objects and click Export to begin.
                  <br />Progress will appear here.
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
                <StatsSummary stats={stats} title="Picklist Export Summary" />
                <DownloadButton url={downloadUrl} label="Download Excel File" />
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
          📌 <strong>7 columns:</strong> Object · Field Label · Field API · Value Label · Value API · Status · IsGlobal?
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
          🌐 <strong>Global Value Sets</strong> detected via Tooling API
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '2px 10px' }}>
          📋 <strong>Both</strong> active + inactive values included
        </span>
      </div>

    </div>
  )
}
'use client'

import { useState, useEffect, useMemo } from 'react'
import ExportButton   from '@/components/ExportButton'
import ProgressBar    from '@/components/ProgressBar'
import DownloadButton from '@/components/DownloadButton'
import StatsSummary   from '@/components/StatsSummary'
import { useExport }  from '@/hooks/useExport'

const FORMAT_META = {
  TABULAR: { label: 'Tabular', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  SUMMARY: { label: 'Summary', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  MATRIX:  { label: 'Matrix',  color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
  JOINED:  { label: 'Joined',  color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
}

function FormatBadge({ format }) {
  const m = FORMAT_META[format] || FORMAT_META.TABULAR
  return (
    <span style={{
      padding: '1px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
      letterSpacing: '0.04em', background: m.bg, color: m.color,
      border: `1px solid ${m.color}44`, flexShrink: 0,
    }}>
      {m.label}
    </span>
  )
}

export default function ReportExporterPage() {
  const [reports,       setReports]       = useState([])
  const [folders,       setFolders]       = useState([])
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [listError,     setListError]     = useState(null)
  const [selected,      setSelected]      = useState(new Set())
  const [search,        setSearch]        = useState('')
  const [folderFilter,  setFolderFilter]  = useState('all')
  const [exportFormat,  setExportFormat]  = useState('excel')

  const { isRunning, progress, downloadUrl, stats, error, startExport, cancel } = useExport()

  async function loadReports() {
    setIsLoadingList(true)
    setListError(null)
    setSelected(new Set())
    try {
      const res  = await fetch('/api/reports/folders')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setReports(data.reports || [])
      setFolders(data.folders || [])
    } catch (err) {
      setListError(err.message)
    } finally {
      setIsLoadingList(false)
    }
  }

  useEffect(() => { loadReports() }, [])

  const filtered = useMemo(() =>
    reports.filter(r => {
      const folderOk = folderFilter === 'all' || r.folderName === folderFilter
      const searchOk = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.folderName.toLowerCase().includes(search.toLowerCase())
      return folderOk && searchOk
    }),
    [reports, search, folderFilter]
  )

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    const ids = filtered.map(r => r.id)
    const allSel = ids.every(id => selected.has(id))
    setSelected(prev => {
      const n = new Set(prev)
      allSel ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id))
      return n
    })
  }

  function handleExport() {
    if (!selected.size) return
    startExport('/api/reports/export', { reportIds: [...selected], format: exportFormat, maxConcurrent: 5 })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const hasActivity = isRunning || progress || downloadUrl || error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── FIXED TITLE BAR ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '14px 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-dark)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>📈</span>
          <h1 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
            Report Exporter
          </h1>
        </div>
        <div style={{
          width: '1px', height: '36px', flexShrink: 0, margin: '0 20px',
          background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
          boxShadow: '0 0 8px var(--accent)',
        }} />
        <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, maxWidth: '560px' }}>
          Export Salesforce reports to Excel or CSV. Excel downloads use Salesforce's native
          endpoint — identical to clicking <em>Export → Excel</em> in the UI. Supports
          Tabular, Summary, Matrix, and Joined reports.
        </p>
      </div>

      {/* ── 2-PANEL MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── LEFT PANEL: Reports (70%) ── */}
        <div style={{
          width: '70%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRight: '1px solid var(--border)',
        }}>

          {/* Toolbar — fixed */}
          <div style={{
            flexShrink: 0, padding: '12px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="field-input"
                style={{ fontFamily: 'var(--font-outfit)', fontSize: '13px', flex: 1, minWidth: '160px' }}
                type="text"
                placeholder="Search reports or folders…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select
                value={folderFilter}
                onChange={e => setFolderFilter(e.target.value)}
                style={{
                  padding: '9px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-hi)',
                  borderRadius: 'var(--radius-sm)', color: '#c9d1d9', fontSize: '13px',
                  fontFamily: 'var(--font-outfit)', cursor: 'pointer', outline: 'none',
                }}
              >
                <option value="all">All Folders ({reports.length})</option>
                {folders.map(f => (
                  <option key={f} value={f}>{f} ({reports.filter(r => r.folderName === f).length})</option>
                ))}
              </select>
              <button
                onClick={loadReports} disabled={isLoadingList}
                style={{ padding: '9px 14px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', color: '#c9d1d9', cursor: 'pointer', fontFamily: 'var(--font-outfit)', whiteSpace: 'nowrap' }}
              >
                {isLoadingList ? '…' : '↺ Reload'}
              </button>
            </div>

            {/* Select all row */}
            {filtered.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', color: 'var(--text-3)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} style={{ accentColor: 'var(--accent)' }} />
                  {allFilteredSelected ? 'Deselect all visible' : 'Select all visible'}
                </label>
                {selected.size > 0 && (
                  <span style={{ color: 'var(--accent-hi)', fontWeight: 500 }}>{selected.size} selected</span>
                )}
                <span>{filtered.length} report{filtered.length !== 1 ? 's' : ''} shown</span>
                {selected.size > 0 && (
                  <button onClick={() => setSelected(new Set())} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '12px', padding: 0 }}>
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Scrollable report list */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {isLoadingList && (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                <div className="spinner" style={{ margin: '0 auto 10px' }} />
                Loading report list…
              </div>
            )}
            {listError && <div className="form-error" style={{ margin: '16px' }}>⚠ {listError}</div>}
            {!isLoadingList && !listError && filtered.length === 0 && (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                {reports.length === 0 ? 'No reports found in this org.' : 'No reports match your filter.'}
              </div>
            )}
            {!isLoadingList && !listError && filtered.map((report, i) => {
              const isSel = selected.has(report.id)
              return (
                <label key={report.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '9px 16px',
                  background: isSel ? 'var(--accent-dim)' : i % 2 === 0 ? 'var(--bg-dark)' : 'var(--bg-card)',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  cursor: 'pointer', transition: 'background 0.1s',
                }}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleSelect(report.id)} style={{ accentColor: 'var(--accent)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: isSel ? '#bfdbfe' : '#c9d1d9', fontWeight: isSel ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {report.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {report.folderName}{report.lastModified && ` · ${new Date(report.lastModified).toLocaleDateString()}`}
                    </div>
                  </div>
                  <FormatBadge format={report.format} />
                </label>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL: Export & Progress (30%) ── */}
        <div style={{ width: '30%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* Export format — horizontal, pinned to top */}
          <div style={{
            flexShrink: 0, padding: '14px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
              Export Format
            </div>
            {/* Horizontal options */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
              {[
                { value: 'excel', label: '📊 Excel (Native)', sub: 'Exact Salesforce formatting' },
                { value: 'csv',   label: '📄 CSV',            sub: 'Raw data, no formatting'    },
              ].map(opt => (
                <label key={opt.value} style={{
                  flex: '1 1 120px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px',
                  background: exportFormat === opt.value ? 'var(--accent-dim)' : 'var(--bg-input)',
                  border: `1px solid ${exportFormat === opt.value ? 'var(--accent)' : 'var(--border-hi)'}`,
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 0.15s',
                  minWidth: 0,
                }}>
                  <input type="radio" value={opt.value} checked={exportFormat === opt.value} onChange={() => setExportFormat(opt.value)} style={{ accentColor: 'var(--accent)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: exportFormat === opt.value ? '#bfdbfe' : '#c9d1d9', fontWeight: 500, whiteSpace: 'nowrap' }}>{opt.label}</div>
                    <div style={{ fontSize: '10.5px', color: '#8b949e', marginTop: '1px' }}>{opt.sub}</div>
                  </div>
                </label>
              ))}
            </div>

            {/* Selection count + export button */}
            <div style={{ padding: '8px 10px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: '10px', fontSize: '13px', color: '#c9d1d9', textAlign: 'center' }}>
              {selected.size > 0
                ? <><span style={{ color: 'var(--accent-hi)', fontWeight: 600, fontSize: '20px' }}>{selected.size}</span> report{selected.size !== 1 ? 's' : ''} selected</>
                : <span style={{ color: 'var(--text-3)' }}>No reports selected</span>
              }
            </div>

            <ExportButton
              onClick={handleExport}
              isRunning={isRunning}
              disabled={selected.size === 0}
              label={selected.size > 0 ? `Export ${selected.size} Report${selected.size !== 1 ? 's' : ''}` : 'Select reports first'}
              runningLabel="Downloading…"
              onCancel={cancel}
            />
          </div>

          {/* Scrollable progress body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>

            {/* Idle state */}
            {!hasActivity && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '10px', textAlign: 'center' }}>
                <span style={{ fontSize: '36px' }}>📈</span>
                <p style={{ fontSize: '12px', color: '#c9d1d9', lineHeight: 1.6 }}>
                  Select reports and click Export.<br />Progress will appear here.
                </p>
                <div style={{ marginTop: '8px', padding: '10px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '11.5px', color: '#8b949e', lineHeight: 1.6, textAlign: 'left' }}>
                  <div><strong style={{ color: '#c9d1d9' }}>Native Excel</strong> — identical to Salesforce's Export button.</div>
                  <div style={{ marginTop: '4px' }}><strong style={{ color: '#c9d1d9' }}>Multiple reports</strong> — packaged into a ZIP automatically.</div>
                </div>
              </div>
            )}

            {/* Progress */}
            {(isRunning || progress) && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>Progress</div>
                <ProgressBar progress={progress} isRunning={isRunning} />
              </div>
            )}

            {error && !isRunning && (
              <div className="form-error" style={{ marginBottom: '12px' }}>⚠ {error}</div>
            )}

            {!isRunning && downloadUrl && (
              <>
                <ProgressBar progress={progress} isRunning={false} />
                <StatsSummary stats={stats} title="Export Summary" />
                <DownloadButton
                  url={downloadUrl}
                  label={selected.size === 1 && exportFormat === 'excel' ? 'Download Excel (.xlsx)' : 'Download ZIP Archive'}
                />
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
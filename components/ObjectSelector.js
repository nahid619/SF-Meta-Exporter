'use client'

import { useState, useEffect, useMemo } from 'react'

/**
 * ObjectSelector — multi-select SObject picker.
 *
 * Props:
 *   selected    string[]                   — currently selected API names
 *   onChange    (selected: string[]) => void
 *   disabled    boolean                    — true while export is running
 *   maxHeight   string                     — used in classic (non-fill) mode
 *   fillHeight  boolean                    — when true, list fills parent flex container
 */

const COMMON_OBJECTS = [
  'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Campaign',
  'Task', 'Event', 'User', 'Product2', 'Pricebook2', 'PricebookEntry',
  'Quote', 'QuoteLineItem', 'Order', 'OrderItem', 'Contract', 'Asset',
  'ServiceContract', 'Entitlement',
]

export default function ObjectSelector({
  selected = [],
  onChange,
  disabled  = false,
  maxHeight = '320px',
  fillHeight = false,
  extraNode = null,   // optional node rendered at the end of the filter chip row
}) {
  const [objects, setObjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')

  useEffect(() => {
    fetch('/api/objects')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setObjects(data.objects)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() =>
    objects.filter(o => o.toLowerCase().includes(search.toLowerCase().trim())),
    [objects, search]
  )

  function toggle(obj) {
    if (disabled) return
    onChange(selected.includes(obj) ? selected.filter(o => o !== obj) : [...selected, obj])
  }

  function selectAll()    { if (!disabled) onChange([...filtered]) }
  function clearAll()     { if (!disabled) onChange([]) }
  function selectCommon() {
    if (disabled) return
    onChange(COMMON_OBJECTS.filter(o => objects.includes(o)))
  }

  if (error) return (
    <div style={{ padding: '12px', color: 'var(--red)', fontSize: '13px', background: 'var(--red-dim)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--red)' }}>
      ⚠ Failed to load objects: {error}
    </div>
  )

  // ── Fill-height mode (used in new 3-panel layout) ─────────────────────────
  if (fillHeight) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

        {/* Search + filters — in panel header, flex-shrink handled by parent */}
        <div style={{ flexShrink: 0, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
            Objects
          </div>
          <input
            className="field-input"
            style={{ fontSize: '12.5px', fontFamily: 'var(--font-outfit)', marginBottom: '8px' }}
            type="text"
            placeholder="Search objects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={loading || disabled}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { label: '⭐ Common Objects', action: selectCommon },
              { label: `✓ All Visible (${filtered.length})`, action: selectAll },
              { label: '✕ Clear', action: clearAll },
            ].map(btn => (
              <button key={btn.label} type="button" onClick={btn.action}
                disabled={loading || disabled}
                style={{
                  padding: '4px 10px', fontSize: '11.5px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-hi)',
                  borderRadius: 'var(--radius-sm)', color: '#c9d1d9',
                  cursor: loading || disabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-outfit)',
                  opacity: loading || disabled ? 0.5 : 1,
                  fontWeight: 500,
                }}
              >{btn.label}</button>
            ))}
            {extraNode && <div style={{ marginLeft: 'auto' }}>{extraNode}</div>}
          </div>
        </div>

        {/* Count row */}
        <div style={{ flexShrink: 0, padding: '6px 14px', fontSize: '11px', color: 'var(--text-3)', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
          {selected.length > 0
            ? <span style={{ color: 'var(--accent-hi)' }}>{selected.length} selected</span>
            : 'No objects selected'}
          {objects.length > 0 && ` of ${objects.length} total`}
          {search && ` · ${filtered.length} matching`}
        </div>

        {/* Scrollable object list — fills remaining panel height */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', opacity: disabled ? 0.6 : 1 }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
              <div className="spinner" style={{ margin: '0 auto 8px', borderTopColor: 'var(--accent)' }} />
              Loading objects from org…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
              No objects match "{search}"
            </div>
          ) : (
            filtered.map(obj => {
              const isSel = selected.includes(obj)
              return (
                <label key={obj} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '7px 14px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  background: isSel ? 'var(--accent-dim)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  transition: 'background 0.1s',
                }}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(obj)}
                    disabled={disabled}
                    style={{ width: '14px', height: '14px', accentColor: 'var(--accent)', cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                  />
                  <span style={{
                    fontFamily: 'var(--font-outfit)',
                    fontSize: '13px',
                    color: isSel ? '#bfdbfe' : 'var(--text-1)',
                    letterSpacing: '0.01em',
                  }}>{obj}</span>
                </label>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // ── Classic mode (used by other pages) ────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <input
        className="field-input"
        style={{ fontFamily: 'var(--font-outfit)', fontSize: '12.5px' }}
        type="text"
        placeholder="Search objects…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        disabled={loading || disabled}
      />
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {[
          { label: '⭐ Common Objects', action: selectCommon },
          { label: `✓ All Visible (${filtered.length})`, action: selectAll },
          { label: '✕ Clear', action: clearAll },
        ].map(btn => (
          <button key={btn.label} type="button" onClick={btn.action}
            disabled={loading || disabled}
            style={{
              padding: '5px 10px', fontSize: '11.5px',
              background: 'var(--bg-card)', border: '1px solid var(--border-hi)',
              borderRadius: 'var(--radius-sm)', color: '#c9d1d9',
              cursor: loading || disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-outfit)', opacity: loading || disabled ? 0.5 : 1,
              fontWeight: 500,
            }}
          >{btn.label}</button>
        ))}
      </div>
      <div style={{ height: maxHeight, overflowY: 'auto', background: 'var(--bg-input)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', opacity: disabled ? 0.6 : 1 }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
            <div className="spinner" style={{ margin: '0 auto 8px', borderTopColor: 'var(--accent)' }} />
            Loading objects from org…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
            No objects match "{search}"
          </div>
        ) : (
          filtered.map(obj => {
            const isSel = selected.includes(obj)
            return (
              <label key={obj} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '7px 12px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: isSel ? 'var(--accent-dim)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                transition: 'background 0.1s',
              }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(obj)} disabled={disabled}
                  style={{ width: '14px', height: '14px', accentColor: 'var(--accent)', cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-outfit)', fontSize: '13px', color: isSel ? '#bfdbfe' : 'var(--text-1)' }}>{obj}</span>
              </label>
            )
          })
        )}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          {selected.length > 0
            ? <span style={{ color: 'var(--accent-hi)' }}>{selected.length} selected</span>
            : 'No objects selected'}
          {objects.length > 0 && ` of ${objects.length} total`}
        </span>
        {search && <span>{filtered.length} matching search</span>}
      </div>
    </div>
  )
}
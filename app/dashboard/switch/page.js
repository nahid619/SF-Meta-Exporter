'use client'

import { useReducer, useCallback, useRef } from 'react'
import ToggleSwitch from '@/components/ToggleSwitch'

// ─── State ────────────────────────────────────────────────────────────────────

const TYPE_META = {
  ValidationRule: { label: 'Validation Rule', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', short: 'VR' },
  WorkflowRule:   { label: 'Workflow Rule',   color: '#10B981', bg: 'rgba(16,185,129,0.12)', short: 'WF' },
  Flow:           { label: 'Flow',            color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', short: 'FL' },
  ApexTrigger:    { label: 'Apex Trigger',    color: '#A78BFA', bg: 'rgba(167,139,250,0.12)', short: 'TR' },
}

const initial = {
  components:   [],
  changes:      {},   // id → newIsActive
  results:      {},   // id → { success, error }
  isLoading:    false,
  isDeploying:  false,
  loadLogs:     [],
  deployLogs:   [],
  tab:          'all',
  search:       '',
  showConfirm:  false,
  deployDone:   false,
}

function reducer(state, action) {
  switch (action.type) {

    case 'LOAD_START':
      return { ...state, isLoading: true, components: [], changes: {}, results: {}, loadLogs: [], deployLogs: [], deployDone: false }

    case 'LOAD_LOG':
      return { ...state, loadLogs: [...state.loadLogs, action.entry] }

    case 'LOAD_COMPONENTS': {
      const existing = state.components.filter(c => c.type !== typeName(action.componentType))
      return { ...state, components: [...existing, ...action.items] }
    }

    case 'LOAD_DONE':
      return { ...state, isLoading: false }

    case 'TOGGLE': {
      const comp = state.components.find(c => c.id === action.id)
      if (!comp) return state
      const newChanges = { ...state.changes }
      if (action.newActive === comp.originalIsActive) {
        delete newChanges[action.id]
      } else {
        newChanges[action.id] = action.newActive
      }
      return {
        ...state,
        changes: newChanges,
        components: state.components.map(c =>
          c.id === action.id ? { ...c, isActive: action.newActive } : c
        ),
      }
    }

    case 'SET_ALL': {
      const newChanges = {}
      const newComponents = state.components.map(c => {
        if (action.types && !action.types.includes(c.type)) return c
        if (action.newActive !== c.originalIsActive) newChanges[c.id] = action.newActive
        return { ...c, isActive: action.newActive }
      })
      return { ...state, components: newComponents, changes: newChanges }
    }

    case 'ROLLBACK':
      return {
        ...state,
        changes: {},
        results: {},
        deployDone: false,
        components: state.components.map(c => ({ ...c, isActive: c.originalIsActive })),
      }

    case 'DEPLOY_START':
      return { ...state, isDeploying: true, deployLogs: [], results: {}, showConfirm: false, deployDone: false }

    case 'DEPLOY_LOG':
      return { ...state, deployLogs: [...state.deployLogs, action.entry] }

    case 'DEPLOY_RESULT': {
      const newResults = { ...state.results, [action.id]: { success: action.success, error: action.error } }
      // On success, commit the change (update originalIsActive)
      const newComponents = action.success
        ? state.components.map(c => c.id === action.id ? { ...c, originalIsActive: c.isActive } : c)
        : state.components
      return { ...state, results: newResults, components: newComponents }
    }

    case 'DEPLOY_DONE': {
      const successIds = new Set(action.succeeded.map(s => s.id))
      const newChanges = { ...state.changes }
      successIds.forEach(id => delete newChanges[id])
      return { ...state, isDeploying: false, deployDone: true, changes: newChanges }
    }

    case 'SET_TAB':    return { ...state, tab: action.tab }
    case 'SET_SEARCH': return { ...state, search: action.search }
    case 'SHOW_CONFIRM': return { ...state, showConfirm: action.show }

    default: return state
  }
}

function typeName(componentType) {
  const map = {
    validationRules: 'ValidationRule',
    workflowRules:   'WorkflowRule',
    flows:           'Flow',
    triggers:        'ApexTrigger',
  }
  return map[componentType] || componentType
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SFSwitchPage() {
  const [state, dispatch] = useReducer(reducer, initial)
  const abortRef = useRef(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  async function handleLoad() {
    dispatch({ type: 'LOAD_START' })
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/switch/load', {
        method: 'POST',
        signal: abortRef.current.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buf     = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        const blocks = buf.split('\n\n')
        buf = blocks.pop()

        for (const block of blocks) {
          const dataLine = block.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'components') {
              dispatch({ type: 'LOAD_COMPONENTS', componentType: evt.componentType, items: evt.items })
            } else if (evt.type === 'done') {
              dispatch({ type: 'LOAD_DONE' })
            } else {
              dispatch({ type: 'LOAD_LOG', entry: { kind: evt.type, msg: evt.message } })
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        dispatch({ type: 'LOAD_LOG', entry: { kind: 'error', msg: err.message } })
      }
    } finally {
      dispatch({ type: 'LOAD_DONE' })
    }
  }

  // ── Deploy ─────────────────────────────────────────────────────────────────
  const handleDeploy = useCallback(async () => {
    const changedComponents = state.components
      .filter(c => c.id in state.changes)
      .map(c => ({
        id:            c.id,
        type:          c.type,
        isActive:      c.isActive,
        name:          c.name,
        objectName:    c.objectName,
        body:          c.body,
        apiVersion:    c.apiVersion,
        definitionId:  c.definitionId,
        versionNumber: c.versionNumber,
      }))

    if (!changedComponents.length) return

    dispatch({ type: 'DEPLOY_START' })
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/switch/deploy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ changes: changedComponents }),
        signal:  abortRef.current.signal,
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buf     = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        const blocks = buf.split('\n\n')
        buf = blocks.pop()

        for (const block of blocks) {
          const dataLine = block.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'result') {
              dispatch({ type: 'DEPLOY_RESULT', id: evt.id, success: evt.success, error: evt.error })
            } else if (evt.type === 'deployComplete') {
              dispatch({ type: 'DEPLOY_DONE', succeeded: evt.succeeded, failed: evt.failed })
            } else if (evt.message) {
              dispatch({ type: 'DEPLOY_LOG', entry: { kind: evt.type, msg: evt.message } })
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        dispatch({ type: 'DEPLOY_LOG', entry: { kind: 'error', msg: err.message } })
        dispatch({ type: 'DEPLOY_DONE', succeeded: [], failed: [] })
      }
    }
  }, [state.components, state.changes])

  // ── Derived state ──────────────────────────────────────────────────────────
  const allComp      = state.components
  const pendingCount = Object.keys(state.changes).length
  const hasTriggers  = allComp.filter(c => c.id in state.changes && c.type === 'ApexTrigger').length > 0

  const tabCounts = {
    all:             allComp.length,
    validationRules: allComp.filter(c => c.type === 'ValidationRule').length,
    workflowRules:   allComp.filter(c => c.type === 'WorkflowRule').length,
    flows:           allComp.filter(c => c.type === 'Flow').length,
    triggers:        allComp.filter(c => c.type === 'ApexTrigger').length,
  }

  const tabTypeMap = {
    all:             null,
    validationRules: 'ValidationRule',
    workflowRules:   'WorkflowRule',
    flows:           'Flow',
    triggers:        'ApexTrigger',
  }

  const filtered = allComp.filter(c => {
    const typeOk   = !tabTypeMap[state.tab] || c.type === tabTypeMap[state.tab]
    const searchOk = !state.search || c.name.toLowerCase().includes(state.search.toLowerCase()) || c.objectName?.toLowerCase().includes(state.search.toLowerCase())
    return typeOk && searchOk
  })

  const isLoaded = allComp.length > 0

  // ── Render ─────────────────────────────────────────────────────────────────
  const logKindColor = { info: 'var(--text-2)', success: 'var(--green)', error: 'var(--red)', warn: 'var(--amber)' }

  return (
    <div className="dash-page-padded" style={{ flex: 1, overflowY: 'auto', padding: '28px' }}><div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '5px' }}>
          <span style={{ fontSize: '28px' }}>⚡</span>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-1)' }}>SF Switch</h1>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-2)', maxWidth: '600px' }}>
          Bulk enable/disable Validation Rules, Workflow Rules, Flows, and Apex Triggers.
          Changes are deployed to Salesforce via Tooling API and MetadataContainer.
        </p>
        {/* Critical warning — mirrors Python app exactly */}
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid var(--amber)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: '#fcd34d', maxWidth: '640px' }}>
          ⚠ <strong>Critical:</strong> Trigger deploys run all Apex tests — allow 5–15 min. Deploy during maintenance windows when possible.
        </div>
      </div>

      {/* Load button */}
      {!isLoaded && !state.isLoading && (
        <button className="btn-primary" onClick={handleLoad} style={{ width: 'auto', marginTop: 0, padding: '11px 28px' }}>
          Load Automation Components
        </button>
      )}

      {/* Loading progress */}
      {state.isLoading && (
        <div style={{ padding: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', fontSize: '13px', color: 'var(--text-2)' }}>
            <div className="spinner" /> Loading components from org…
          </div>
          {state.loadLogs.slice(-5).map((l, i) => (
            <div key={i} style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: logKindColor[l.kind] || 'var(--text-3)', marginBottom: '2px' }}>
              {l.msg}
            </div>
          ))}
        </div>
      )}

      {/* Main content — shown after load */}
      {isLoaded && (
        <>
          {/* Reload + bulk actions */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
            <button onClick={handleLoad} disabled={state.isLoading || state.isDeploying} style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'var(--font-outfit)' }}>
              ↺ Reload
            </button>
            <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px' }} />
            <button onClick={() => dispatch({ type: 'SET_ALL', newActive: false })} disabled={state.isDeploying} style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', color: '#fca5a5', cursor: 'pointer', fontFamily: 'var(--font-outfit)' }}>
              Disable All
            </button>
            <button onClick={() => dispatch({ type: 'SET_ALL', newActive: true })} disabled={state.isDeploying} style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--green-dim)', border: '1px solid var(--green)', borderRadius: 'var(--radius-sm)', color: '#6ee7b7', cursor: 'pointer', fontFamily: 'var(--font-outfit)' }}>
              Enable All
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}>
            {Object.entries(tabCounts).map(([tab, count]) => (
              <button
                key={tab}
                onClick={() => dispatch({ type: 'SET_TAB', tab })}
                style={{
                  padding: '6px 12px', fontSize: '12.5px', borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${state.tab === tab ? 'var(--accent)' : 'var(--border)'}`,
                  background: state.tab === tab ? 'var(--accent-dim)' : 'var(--bg-card)',
                  color: state.tab === tab ? '#bfdbfe' : 'var(--text-2)',
                  cursor: 'pointer', fontFamily: 'var(--font-outfit)', transition: 'all 0.15s',
                }}
              >
                {tab === 'all' ? 'All' : tab === 'validationRules' ? 'VR' : tab === 'workflowRules' ? 'Workflow' : tab === 'flows' ? 'Flows' : 'Triggers'}
                {' '}<span style={{ opacity: 0.7 }}>({count})</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ marginBottom: '10px' }}>
            <input
              className="field-input"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              type="text"
              placeholder="Filter by name or object…"
              value={state.search}
              onChange={e => dispatch({ type: 'SET_SEARCH', search: e.target.value })}
            />
          </div>

          {/* Component list */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', maxHeight: '460px', overflowY: 'auto', marginBottom: '14px' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                No components match your filter.
              </div>
            ) : (
              filtered.map((comp, i) => {
                const meta     = TYPE_META[comp.type] || TYPE_META.ValidationRule
                const isPending = comp.id in state.changes
                const result    = state.results[comp.id]

                return (
                  <div
                    key={comp.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '9px 14px',
                      background: i % 2 === 0 ? 'var(--bg-dark)' : 'var(--bg-card)',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                    }}
                  >
                    <ToggleSwitch
                      checked={comp.isActive}
                      onChange={v => dispatch({ type: 'TOGGLE', id: comp.id, newActive: v })}
                      disabled={state.isDeploying}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {comp.name}
                        </span>
                        {isPending && !result && (
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} title="Pending change" />
                        )}
                        {result?.success  && <span style={{ color: 'var(--green)',  fontSize: '11px' }}>✓</span>}
                        {result && !result.success && <span style={{ color: 'var(--red)', fontSize: '11px' }} title={result.error}>✗</span>}
                      </div>
                      {(comp.objectName || comp.apiName) && (
                        <div style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {comp.objectName}{comp.objectName && comp.apiName ? ' · ' : ''}{comp.apiName && comp.apiName !== comp.name ? comp.apiName : ''}
                        </div>
                      )}
                    </div>

                    {/* Type badge */}
                    <span style={{
                      padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                      letterSpacing: '0.04em',
                      background: meta.bg, color: meta.color,
                      border: `1px solid ${meta.color}44`,
                      flexShrink: 0,
                    }}>
                      {meta.short}
                    </span>

                    {/* Active/Inactive label */}
                    <span style={{ fontSize: '11px', color: comp.isActive ? 'var(--green)' : 'var(--text-3)', flexShrink: 0, width: '52px', textAlign: 'right' }}>
                      {comp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* Pending changes bar */}
          {(pendingCount > 0 || state.deployDone) && (
            <div style={{
              padding: '12px 16px',
              background: 'var(--bg-card)',
              border: `1px solid ${pendingCount > 0 ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <span style={{ fontSize: '13px', color: 'var(--text-2)', flex: 1 }}>
                {state.deployDone
                  ? '✓ Deploy complete'
                  : `${pendingCount} pending change${pendingCount !== 1 ? 's' : ''}`
                }
                {hasTriggers && !state.deployDone && (
                  <span style={{ marginLeft: '8px', fontSize: '11.5px', color: 'var(--amber)' }}>
                    ⚠ includes trigger(s) — 5–15 min
                  </span>
                )}
              </span>

              {pendingCount > 0 && (
                <>
                  <button
                    onClick={() => dispatch({ type: 'ROLLBACK' })}
                    disabled={state.isDeploying}
                    className="btn-ghost"
                    style={{ padding: '7px 16px' }}
                  >
                    ↩ Rollback
                  </button>
                  <button
                    onClick={() => dispatch({ type: 'SHOW_CONFIRM', show: true })}
                    disabled={state.isDeploying}
                    className="btn-primary"
                    style={{ marginTop: 0, width: 'auto', padding: '8px 20px' }}
                  >
                    {state.isDeploying
                      ? <><div className="spinner" /> Deploying…</>
                      : `Deploy ${pendingCount} Change${pendingCount !== 1 ? 's' : ''} →`
                    }
                  </button>
                </>
              )}
            </div>
          )}

          {/* Deploy progress log */}
          {state.deployLogs.length > 0 && (
            <div style={{ marginTop: '10px', padding: '12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto' }}>
              {state.deployLogs.map((l, i) => (
                <div key={i} style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: logKindColor[l.kind] || 'var(--text-2)', marginBottom: '2px' }}>
                  {l.msg}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Confirm modal ── */}
      {state.showConfirm && (
        <>
          <div onClick={() => dispatch({ type: 'SHOW_CONFIRM', show: false })} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 201, background: 'var(--bg-card)', border: '1px solid var(--border-hi)',
            borderRadius: 'var(--radius-xl)', padding: '28px', width: 'min(480px, 90vw)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
          }}>
            <h3 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '12px' }}>
              Confirm Deployment
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '16px', lineHeight: 1.6 }}>
              You are about to deploy <strong style={{ color: 'var(--text-1)' }}>{pendingCount} change{pendingCount !== 1 ? 's' : ''}</strong> to Salesforce.
            </p>
            {hasTriggers && (
              <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.12)', border: '1px solid var(--amber)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: '#fcd34d', marginBottom: '16px' }}>
                ⚠ <strong>Trigger changes included</strong> — all Apex tests will run. This may take 5–15 minutes in production. Consider deploying during a maintenance window.
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => dispatch({ type: 'SHOW_CONFIRM', show: false })}>Cancel</button>
              <button className="btn-primary" onClick={handleDeploy} style={{ marginTop: 0, width: 'auto', padding: '10px 24px' }}>
                Deploy Now
              </button>
            </div>
          </div>
        </>
      )}
    </div></div>
  )
}
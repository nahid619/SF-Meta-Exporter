'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'

// ─── Monaco dynamically imported (browser-only) ───────────────────────────────
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr:     false,
  loading: () => (
    <div style={{ height: '180px', background: '#060b14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4f6680', fontSize: '13px', borderRadius: '0 0 var(--radius-md) var(--radius-md)', fontFamily: 'var(--font-mono)' }}>
      Loading editor…
    </div>
  ),
})

// ─── Constants ────────────────────────────────────────────────────────────────

const SOQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'LIKE',
  'ORDER BY', 'GROUP BY', 'LIMIT', 'OFFSET', 'HAVING', 'WITH SECURITY_ENFORCED',
  'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'NULL', 'TRUE', 'FALSE',
  'COUNT()', 'COUNT(Id)', 'SUM()', 'AVG()', 'MIN()', 'MAX()',
  'TODAY', 'YESTERDAY', 'TOMORROW', 'LAST_WEEK', 'THIS_WEEK', 'NEXT_WEEK',
  'LAST_MONTH', 'THIS_MONTH', 'NEXT_MONTH', 'THIS_QUARTER', 'LAST_QUARTER',
  'NEXT_QUARTER', 'THIS_YEAR', 'LAST_YEAR', 'NEXT_YEAR',
  'LAST_90_DAYS', 'NEXT_90_DAYS', 'LAST_N_DAYS:n', 'NEXT_N_DAYS:n',
  'TYPEOF', 'WHEN', 'THEN', 'ELSE', 'END', 'FORMAT',
]

const SAMPLE_QUERIES = [
  {
    label: 'Accounts (50)',
    query: 'SELECT Id, Name, AccountNumber, Industry, AnnualRevenue, OwnerId\nFROM Account\nLIMIT 50',
  },
  {
    label: 'Open Opportunities',
    query: 'SELECT Id, Name, Amount, CloseDate, StageName, AccountId\nFROM Opportunity\nWHERE IsClosed = false\nORDER BY CloseDate ASC\nLIMIT 100',
  },
  {
    label: 'Active Users',
    query: 'SELECT Id, Name, Email, Username, IsActive, LastLoginDate\nFROM User\nWHERE IsActive = true\nORDER BY LastLoginDate DESC\nLIMIT 50',
  },
  {
    label: 'Recent Cases',
    query: "SELECT Id, CaseNumber, Subject, Status, Priority, AccountId, CreatedDate\nFROM Case\nWHERE CreatedDate = LAST_90_DAYS\nORDER BY CreatedDate DESC\nLIMIT 100",
  },
  {
    label: 'Custom Objects',
    query: 'SELECT QualifiedApiName, Label, IsCustomizable\nFROM EntityDefinition\nWHERE IsCustomizable = true\nORDER BY QualifiedApiName\nLIMIT 200',
  },
]

const HISTORY_KEY = 'sfmeta_soql_history'
const MAX_HISTORY = 20
const MAX_DISPLAY_ROWS = 5000

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Mirrors get_object_from_query() in soql_runner.py */
function extractFromObject(soql) {
  const m = soql.match(/\bFROM\s+([A-Za-z0-9_]+)/i)
  return m ? m[1] : null
}

/** Mirrors format_query() in soql_runner.py */
function formatSOQL(soql) {
  let q = soql.trim()
  q = q.replace(/\bFROM\b/gi, '\nFROM')
  q = q.replace(/\bWHERE\b/gi, '\nWHERE')
  q = q.replace(/\bAND\b/gi, '\n  AND')
  q = q.replace(/\bOR\b/gi, '\n  OR')
  q = q.replace(/\bORDER BY\b/gi, '\nORDER BY')
  q = q.replace(/\bGROUP BY\b/gi, '\nGROUP BY')
  q = q.replace(/\bHAVING\b/gi, '\nHAVING')
  q = q.replace(/\bLIMIT\b/gi, '\nLIMIT')
  q = q.replace(/\bOFFSET\b/gi, '\nOFFSET')
  return q.replace(/\n{3,}/g, '\n\n').trim()
}

function saveHistory(query) {
  try {
    const prev = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    const next = [query, ...prev.filter(q => q !== query)].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}

function clientCSV(records, columns) {
  const esc = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map(esc), ...records.map(r => columns.map(c => esc(r[c])))].join('\r\n')
}

function triggerCSVDownload(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Monaco language setup ────────────────────────────────────────────────────

function setupSOQLLanguage(monaco) {
  // Guard: only register once across hot reloads
  if (monaco.languages.getLanguages().some(l => l.id === 'soql')) return

  monaco.languages.register({ id: 'soql' })

  monaco.languages.setMonarchTokensProvider('soql', {
    ignoreCase: true,
    keywords: [
      'select','from','where','and','or','not','in','like','order','by','group',
      'having','limit','offset','asc','desc','nulls','first','last','null',
      'true','false','with','security_enforced','typeof','when','then','else','end',
      'format','using','scope',
    ],
    dateLiterals: [
      'today','yesterday','tomorrow','last_week','this_week','next_week',
      'last_month','this_month','next_month','last_quarter','this_quarter','next_quarter',
      'last_year','this_year','next_year','last_90_days','next_90_days',
    ],
    aggregates: ['count','sum','avg','min','max'],
    tokenizer: {
      root: [
        [/\b(today|yesterday|tomorrow|last_week|this_week|next_week|last_month|this_month|next_month|last_quarter|this_quarter|next_quarter|last_year|this_year|next_year|last_90_days|next_90_days|last_n_days:\d+|next_n_days:\d+)\b/i, 'constant.language'],
        [/\b(count|sum|avg|min|max)\s*\(/i, 'keyword.function'],
        [/\b(select|from|where|and|or|not|in|like|order\s+by|group\s+by|having|limit|offset|asc|desc|nulls\s+first|nulls\s+last|null|true|false|with\s+security_enforced|typeof|when|then|else|end|format)\b/i, 'keyword'],
        [/'[^']*'/, 'string'],
        [/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?/, 'string.date'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/[<>=!]+/, 'operator'],
        [/[A-Za-z_][A-Za-z0-9_.]*/, 'identifier'],
        [/[()[\]]/, 'delimiter.bracket'],
        [/,/, 'delimiter'],
      ],
    },
  })

  monaco.editor.defineTheme('soql-dark', {
    base:    'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword',           foreground: '569CD6', fontStyle: 'bold' },
      { token: 'keyword.function',  foreground: 'DCDCAA' },
      { token: 'constant.language', foreground: '4EC9B0' },
      { token: 'string',            foreground: 'CE9178' },
      { token: 'string.date',       foreground: '4EC9B0' },
      { token: 'number',            foreground: 'B5CEA8' },
      { token: 'identifier',        foreground: '9CDCFE' },
      { token: 'operator',          foreground: 'D4D4D4' },
      { token: 'delimiter',         foreground: '808080' },
      { token: 'delimiter.bracket', foreground: 'FFD700' },
    ],
    colors: {
      'editor.background':            '#060b14',
      'editor.foreground':            '#d4d4d4',
      'editor.lineHighlightBackground':'#0d1829',
      'editorCursor.foreground':      '#2563eb',
      'editor.selectionBackground':   '#1e3a8a55',
      'editorLineNumber.foreground':  '#4f6680',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editor.inactiveSelectionBackground': '#1e3a8a33',
      'editorSuggestWidget.background': '#0d1829',
      'editorSuggestWidget.border':    '#1a2d52',
      'editorSuggestWidget.selectedBackground': '#1e3a8a',
    },
  })
}

function registerCompletion(monaco, objectsRef, fieldsCacheRef) {
  return monaco.languages.registerCompletionItemProvider('soql', {
    triggerCharacters: [' ', '\n', '\t', ',', '('],
    provideCompletionItems: async (model, position) => {
      const fullText  = model.getValue()
      const lineText  = model.getLineContent(position.lineNumber)
      const before    = lineText.substring(0, position.column - 1)

      const word  = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       word.endColumn,
      }

      const KW  = monaco.languages.CompletionItemKind.Keyword
      const CLS = monaco.languages.CompletionItemKind.Class
      const FLD = monaco.languages.CompletionItemKind.Field

      // ── After FROM: suggest SObject names ──────────────────────────────
      if (/\bFROM\s+\w*$/i.test(before)) {
        return {
          suggestions: (objectsRef.current || []).map(name => ({
            label: name, kind: CLS, insertText: name, range,
            detail: 'SObject',
          })),
        }
      }

      // ── Keywords + field suggestions ────────────────────────────────────
      const fromObj = extractFromObject(fullText)

      let fieldSuggestions = []
      if (fromObj) {
        // Fetch fields (cached per object)
        if (!fieldsCacheRef.current[fromObj]) {
          try {
            const res  = await fetch(`/api/soql/fields?object=${fromObj}`)
            const data = await res.json()
            fieldsCacheRef.current[fromObj] = data.fields || []
          } catch {
            fieldsCacheRef.current[fromObj] = []
          }
        }

        fieldSuggestions = (fieldsCacheRef.current[fromObj] || []).map(f => ({
          label:      f.name,
          kind:       FLD,
          insertText: f.name,
          range,
          detail:     `${f.label} (${f.type})`,
          documentation: f.referenceTo?.length ? `→ ${f.referenceTo.join(', ')}` : undefined,
          sortText:   `0_${f.name}`,  // fields before keywords
        }))
      }

      const kwSuggestions = SOQL_KEYWORDS.map(kw => ({
        label:      kw,
        kind:       KW,
        insertText: kw,
        range,
        sortText:   `1_${kw}`,
      }))

      return { suggestions: [...fieldSuggestions, ...kwSuggestions] }
    },
  })
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsGrid({ records, totalSize }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const columns = useMemo(() =>
    records.length > 0 ? Object.keys(records[0]) : [],
    [records]
  )

  const sorted = useMemo(() => {
    const slice = records.slice(0, MAX_DISPLAY_ROWS)
    if (!sortCol) return slice
    return [...slice].sort((a, b) => {
      const va = String(a[sortCol] ?? '')
      const vb = String(b[sortCol] ?? '')
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [records, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  // Estimate column widths from headers + sampled data
  const colWidths = useMemo(() => {
    return columns.map(col => {
      const headerLen = col.length
      const sample    = records.slice(0, 50).map(r => String(r[col] ?? '').length)
      const maxLen    = Math.max(headerLen, ...sample)
      return Math.min(Math.max(maxLen * 8 + 24, 80), 300)
    })
  }, [columns, records])

  const TH_STYLE = {
    padding:         '8px 12px',
    textAlign:       'left',
    fontSize:        '11px',
    fontWeight:      700,
    letterSpacing:   '0.04em',
    textTransform:   'uppercase',
    color:           '#8b949e',
    background:      'var(--bg-card-alt)',
    borderBottom:    '1px solid var(--border)',
    borderRight:     '1px solid var(--border)',
    cursor:          'pointer',
    userSelect:      'none',
    whiteSpace:      'nowrap',
    transition:      'color 0.1s',
    position:        'sticky',
    top:             0,
  }

  const TD_STYLE = {
    padding:      '7px 12px',
    fontSize:     '13px',
    fontFamily:   'var(--font-outfit)',
    color:        '#c9d1d9',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    borderRight:  '1px solid rgba(255,255,255,0.04)',
    maxWidth:     '300px',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  }

  if (columns.length === 0) return null

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '420px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map((col, i) => <col key={col} style={{ width: colWidths[i] }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col}
                style={{ ...TH_STYLE, color: sortCol === col ? 'var(--accent-hi)' : 'var(--text-3)' }}
                onClick={() => handleSort(col)}
                title={`Sort by ${col}`}
              >
                {col}
                {sortCol === col && <span style={{ marginLeft: '4px' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              style={{ background: i % 2 === 0 ? 'var(--bg-dark)' : 'var(--bg-card)' }}
            >
              {columns.map(col => {
                const val = row[col]
                const isNull = val === null || val === undefined
                const str    = isNull ? '' : String(val)
                return (
                  <td key={col} style={TD_STYLE} title={str}>
                    {isNull
                      ? <span style={{ opacity: 0.3, fontStyle: 'italic' }}>null</span>
                      : str
                    }
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DEFAULT_QUERY = 'SELECT Id, Name\nFROM Account\nLIMIT 10'

export default function SOQLRunnerPage() {
  const [query,       setQuery]       = useState(DEFAULT_QUERY)
  const [result,      setResult]      = useState(null)   // { records, totalSize, count, elapsed, error, apiUsage }
  const [isLoading,   setIsLoading]   = useState(false)
  const [showSamples, setShowSamples] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history,     setHistory]     = useState([])
  const [objects,     setObjects]     = useState([])
  const [editorHeight, setEditorHeight] = useState(260)  // px, user-resizable

  // Refs for Monaco callbacks (avoids stale closures)
  const editorRef      = useRef(null)
  const executeRef     = useRef(null)
  const objectsRef     = useRef([])
  const fieldsCacheRef = useRef({})
  const completionRef  = useRef(null)

  // Load SObjects + history on mount
  useEffect(() => {
    setHistory(loadHistory())
    fetch('/api/objects')
      .then(r => r.json())
      .then(d => {
        const list = d.objects || []
        setObjects(list)
        objectsRef.current = list
      })
      .catch(() => {})
  }, [])

  // Keep executeRef in sync so the Ctrl+Enter binding always calls latest fn
  const handleExecute = useCallback(async () => {
    const q = (editorRef.current?.getValue() ?? query).trim()
    if (!q || isLoading) return

    setIsLoading(true)
    setResult(null)

    try {
      const res  = await fetch('/api/soql/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ soql: q }),
      })
      const data = await res.json()
      setResult(data)
      if (!data.error) {
        saveHistory(q)
        setHistory(loadHistory())
      }
    } catch (err) {
      setResult({ records: [], totalSize: 0, count: 0, elapsed: '—', error: err.message })
    } finally {
      setIsLoading(false)
    }
  }, [query, isLoading])

  executeRef.current = handleExecute

  function handleBeforeMount(monaco) {
    setupSOQLLanguage(monaco)
    // Register completion provider once
    if (!completionRef.current) {
      completionRef.current = registerCompletion(monaco, objectsRef, fieldsCacheRef)
    }
  }

  function handleEditorMount(editor, monaco) {
    editorRef.current = editor
    // Ctrl+Enter → execute (mirrors desktop app keyboard shortcut)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => executeRef.current?.()
    )
    editor.focus()
  }

  function handleFormat() {
    const current = editorRef.current?.getValue() ?? query
    const formatted = formatSOQL(current)
    editorRef.current?.setValue(formatted)
    setQuery(formatted)
  }

  function handleSampleSelect(sample) {
    editorRef.current?.setValue(sample.query)
    setQuery(sample.query)
    setShowSamples(false)
    editorRef.current?.focus()
  }

  function handleHistorySelect(q) {
    editorRef.current?.setValue(q)
    setQuery(q)
    setShowHistory(false)
    editorRef.current?.focus()
  }

  function handleExportCSV() {
    if (!result?.records?.length) return
    const columns = Object.keys(result.records[0])
    const csv     = clientCSV(result.records, columns)
    const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    triggerCSVDownload(csv, `SOQL_Export_${ts}.csv`)
  }

  const hasResults = result && !result.error && result.records?.length > 0
  const columns    = hasResults ? Object.keys(result.records[0]) : []

  return (
    <div className="dash-page-padded"><div>{/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '5px' }}>
          <span style={{ fontSize: '28px' }}>💻</span>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-1)' }}>SOQL Runner</h1>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-2)' }}>
          Interactive SOQL editor with syntax highlighting, Ctrl+Space autocomplete, and CSV export.
          <span style={{ marginLeft: '10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)' }}>Ctrl+Enter to run</span>
        </p>
      </div>

      {/* Editor card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '12px' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)', marginRight: '4px' }}>SOQL</span>

          {/* Samples dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowSamples(s => !s); setShowHistory(false) }}
              style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--bg-input)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'var(--font-outfit)' }}
            >
              Samples ▾
            </button>
            {showSamples && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'var(--bg-card-alt)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-md)', minWidth: '200px', zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                {SAMPLE_QUERIES.map(s => (
                  <button
                    key={s.label}
                    onClick={() => handleSampleSelect(s)}
                    style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', fontSize: '12.5px', color: 'var(--text-2)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-outfit)' }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* History dropdown */}
          {history.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => { setShowHistory(h => !h); setShowSamples(false) }}
                style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--bg-input)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'var(--font-outfit)' }}
              >
                History ({history.length}) ▾
              </button>
              {showHistory && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'var(--bg-card-alt)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-md)', width: '380px', maxHeight: '280px', overflowY: 'auto', zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                  {history.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleHistorySelect(q)}
                      style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', fontSize: '11px', color: 'var(--text-2)', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {q.replace(/\s+/g, ' ').slice(0, 80)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleFormat}
            style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--bg-input)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'var(--font-outfit)', marginLeft: 'auto' }}
          >
            Format
          </button>
        </div>

        {/* Monaco Editor — height is user-resizable via drag handle */}
        <MonacoEditor
          height={`${editorHeight}px`}
          language="soql"
          theme="soql-dark"
          value={query}
          onChange={v => setQuery(v || '')}
          beforeMount={handleBeforeMount}
          onMount={handleEditorMount}
          options={{
            minimap:                  { enabled: false },
            fontSize:                 13,
            fontFamily:               "'JetBrains Mono', 'Courier New', monospace",
            fontLigatures:            true,
            wordWrap:                 'on',
            lineNumbers:              'on',
            scrollBeyondLastLine:     false,
            automaticLayout:          true,
            padding:                  { top: 14, bottom: 14 },
            contextmenu:              false,
            quickSuggestions:         { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
            tabSize:                  2,
            renderWhitespace:         'none',
            smoothScrolling:          true,
            cursorBlinking:           'smooth',
          }}
        />

        {/* Drag handle — lets user resize the editor vertically */}
        <div
          title="Drag to resize editor"
          onMouseDown={e => {
            e.preventDefault()
            const startY = e.clientY
            const startH = editorHeight
            function onMove(ev) {
              const delta = ev.clientY - startY
              setEditorHeight(Math.max(120, Math.min(700, startH + delta)))
            }
            function onUp() {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
          style={{
            height: '8px',
            cursor: 'ns-resize',
            background: 'linear-gradient(to bottom, var(--border), transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <div style={{ width: '32px', height: '2px', borderRadius: '2px', background: 'var(--border-hi)', opacity: 0.6 }} />
        </div>
      </div>

      {/* Execute bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button
          className="btn-primary"
          onClick={handleExecute}
          disabled={isLoading}
          style={{ width: 'auto', minWidth: '140px', marginTop: 0, padding: '10px 20px' }}
        >
          {isLoading
            ? <><div className="spinner" /> Running…</>
            : <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>▶ Run Query</span>
          }
        </button>

        {/* Status */}
        {result && (
          <div style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {result.error ? (
              <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                ✗ {result.error}
              </span>
            ) : (
              <span style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--green)' }}>✓</span>{' '}
                {result.count.toLocaleString()}
                {result.totalSize > result.count && ` of ${result.totalSize.toLocaleString()}`}
                {' '}record{result.count !== 1 ? 's' : ''} · {result.elapsed}
                {result.apiUsage && (
                  <span style={{ color: result.apiUsage.remaining < 1000 ? 'var(--amber)' : 'var(--text-2)', marginLeft: '8px' }}>
                    · API {result.apiUsage.used.toLocaleString()}/{result.apiUsage.total.toLocaleString()} used
                  </span>
                )}
                {result.count > MAX_DISPLAY_ROWS && (
                  <span style={{ color: 'var(--amber)', marginLeft: '8px' }}>
                    (showing first {MAX_DISPLAY_ROWS.toLocaleString()})
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        {/* CSV export */}
        {hasResults && (
          <button
            onClick={handleExportCSV}
            style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', fontSize: '12.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-outfit)', transition: 'border-color 0.15s, color 0.15s' }}
          >
            ↓ Export CSV ({result.totalSize > result.count ? result.totalSize.toLocaleString() : result.count.toLocaleString()} rows)
          </button>
        )}
      </div>

      {/* Results table */}
      {hasResults && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Results — {columns.length} column{columns.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              Click any column header to sort
            </div>
          </div>
          <ResultsGrid records={result.records} totalSize={result.totalSize} />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !result && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)', fontSize: '13px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>💻</div>
          Write a SOQL query above and press <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'var(--bg-input)', border: '1px solid var(--border-hi)', borderRadius: '3px', padding: '2px 5px' }}>Ctrl+Enter</kbd> to run it.
        </div>
      )}

      {/* Click-outside handler for dropdowns */}
      {(showSamples || showHistory) && (
        <div
          onClick={() => { setShowSamples(false); setShowHistory(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 50 }}
        />
      )}
    </div></div>
  )
}
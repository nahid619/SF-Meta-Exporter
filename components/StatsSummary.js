// FILE PATH: components/StatsSummary.js
// components/StatsSummary.js

'use client'

/**
 * StatsSummary — displays export statistics after completion.
 * Mirrors the print_*_statistics() output in utils.py, now as a UI card.
 *
 * Props:
 *   stats    object | null   — the stats payload from useExport's `stats` state
 *   title    string          — e.g. 'Picklist Export Summary'
 *
 * The stats object shape matches whichever createXxxStats() model was used.
 * Unknown keys are ignored — only known display fields are rendered.
 */

const FIELD_CONFIG = {
  // Picklist stats
  totalObjects:        { label: 'Objects in list',         color: null    },
  successfulObjects:   { label: 'Successfully processed',  color: 'green' },
  failedObjects:       { label: 'Failed to process',       color: 'red'   },
  objectsNotFound:     { label: 'Not found in org',        color: 'amber' },
  objectsNoPicklists:  { label: 'No picklist fields',      color: null    },
  totalPicklistFields: { label: 'Total picklist fields',   color: null    },
  totalValues:         { label: 'Total values',            color: null    },
  totalActiveValues:   { label: 'Active values',           color: 'green' },
  totalInactiveValues: { label: 'Inactive values',         color: 'amber' },

  // Metadata stats
  totalFields:         { label: 'Total fields exported',   color: null    },

  // Content Document stats
  totalDocuments:      { label: 'ContentDocuments found',  color: null    },
  totalVersions:       { label: 'Versions found',          color: null    },
  successfulDownloads: { label: 'Downloaded',              color: 'green' },
  failedDownloads:     { label: 'Failed',                  color: 'red'   },
  totalSizeBytes:      { label: 'Total size',              color: null, format: 'bytes' },

  // Common
  runtimeFormatted:    { label: 'Runtime',                 color: null    },

  // Backup stats (module 7)
  totalRecords:          { label: 'Total records backed up',  color: null    },

  // Restore stats (module 7)
  totalRecordsInserted:  { label: 'Records inserted',         color: 'green' },
  totalRecordsFailed:    { label: 'Records failed',           color: 'red'   },

  // Attachment stats (legacy Attachment SObject)
  totalAttachments:      { label: 'Attachments found',        color: null    },
}

function formatValue(key, val) {
  if (FIELD_CONFIG[key]?.format === 'bytes') {
    const mb = (Number(val) / 1024 / 1024).toFixed(2)
    return `${mb} MB`
  }
  return String(val ?? '—')
}

const COLOR_MAP = {
  green: { bg: 'var(--green-dim)',  border: 'var(--green)',  text: '#6ee7b7' },
  red:   { bg: 'var(--red-dim)',    border: 'var(--red)',    text: '#fca5a5' },
  amber: { bg: 'rgba(245,158,11,0.1)', border: 'var(--amber)', text: '#fcd34d' },
}

export default function StatsSummary({ stats, title = 'Export Summary' }) {
  if (!stats) return null

  // Only show fields we have a label for, and skip zero-ish metadata
  const entries = Object.entries(FIELD_CONFIG)
    .filter(([key]) => stats[key] != null)
    .map(([key, cfg]) => ({ key, cfg, value: stats[key] }))

  if (entries.length === 0) return null

  return (
    <div style={{
      marginTop: '16px',
      padding: '16px 18px',
      background: 'var(--bg-card-alt)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '12px' }}>
        {title}
      </div>

      <div style={{ display: 'grid', gap: '6px' }}>
        {entries.map(({ key, cfg, value }) => {
          const colors = cfg.color ? COLOR_MAP[cfg.color] : null
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: colors ? '4px 8px' : '2px 0',
                background:   colors?.bg     ?? 'transparent',
                border:       colors          ? `1px solid ${colors.border}` : 'none',
                borderRadius: colors          ? 'var(--radius-sm)' : '0',
              }}
            >
              <span style={{ fontSize: '12.5px', color: 'var(--text-2)' }}>{cfg.label}</span>
              <span style={{
                fontSize: '12.5px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 500,
                color: colors?.text ?? 'var(--text-1)',
              }}>
                {formatValue(key, value)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Failed object details */}
      {stats.failedObjectDetails?.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11.5px', color: 'var(--red)', fontWeight: 600, marginBottom: '6px' }}>
            ✗ Failed objects
          </div>
          {stats.failedObjectDetails.map((d, i) => (
            <div key={i} style={{ fontSize: '11.5px', color: '#fca5a5', fontFamily: 'var(--font-mono)', marginBottom: '3px' }}>
              • {d.name}: {d.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
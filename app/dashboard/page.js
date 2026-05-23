import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

const MODULES = [
  {
    id: 'picklist', icon: '📊', title: 'Picklist Exporter', phase: 3, done: true,
    href: '/dashboard/picklist',
    desc: 'Export all picklist fields and values — Active/Inactive, Global Value Set detection, styled Excel output.',
  },
  {
    id: 'metadata', icon: '🔍', title: 'Metadata Exporter', phase: 4, done: true,
    href: '/dashboard/metadata',
    desc: '15-column field metadata export with optional field descriptions and usage tracking across 9 sources.',
  },
  {
    id: 'files', icon: '📁', title: 'File Downloader', phase: 5, done: true,
    href: '/dashboard/files',
    desc: 'Bulk-download ContentDocuments with 10 concurrent streams, ZIP output, and CSV manifest.',
  },
  {
    id: 'soql', icon: '💻', title: 'SOQL Runner', phase: 6, done: true,
    href: '/dashboard/soql',
    desc: 'Interactive SOQL editor with syntax highlighting, Ctrl+Space autocomplete, and CSV/Excel export.',
  },
  {
    id: 'switch', icon: '⚡', title: 'SF Switch', phase: 7, done: true,
    href: '/dashboard/switch',
    desc: 'Bulk enable/disable Validation Rules, Workflows, Flows, and Triggers with rollback support.',
  },
  {
    id: 'reports', icon: '📈', title: 'Report Exporter', phase: 8, done: true,
    href: '/dashboard/reports',
    desc: 'Export Salesforce reports preserving groupings, subtotals, and merged cell formatting.',
  },
  {
    id: 'backup', icon: '🔁', title: 'Backup & Restore', phase: 9, done: true,
    href: '/dashboard/backup',
    desc: 'Backup selected objects to a ZIP of CSVs, then restore them into any connected org. Dependency order resolved automatically.',
  },
]

export default async function DashboardPage() {
  const session = await getSession()
  const orgLabel = { production: 'Production', sandbox: 'Sandbox', custom: 'Custom Domain' }[session.orgType] ?? 'Salesforce'
  const liveMods = MODULES.filter(m => m.done).length

  return (
    <div className="dash-page-padded">
      <div style={{ marginBottom: '8px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '4px' }}>Dashboard</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-2)' }}>
          Connected to{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)', fontSize: '12px' }}>
            {session.instanceUrl?.replace('https://', '')}
          </span>
          {' '}({orgLabel}) · API v{session.apiVersion}
        </p>
      </div>

      {/* Progress banner */}
      <div style={{ marginBottom: '24px', padding: '14px 18px', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: '#bfdbfe', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '18px' }}>✅</span>
        <span>
          <strong>Click a module card below to start exporting.</strong>
        </span>
      </div>

      {/* Module cards */}
      <div className="modules-grid">
        {MODULES.map(mod => (
          <a
            key={mod.id}
            href={mod.done ? mod.href : undefined}
            style={{ textDecoration: 'none', cursor: mod.done ? 'pointer' : 'default' }}
          >
            <div className={`module-card ${mod.done ? 'available' : ''}`}>
              <div className="module-card-top">
                <div className="module-card-icon">{mod.icon}</div>
                <span className={`module-card-phase ${mod.done ? 'done' : ''}`}>
                  {mod.done ? '✓ Live' : `Phase ${mod.phase}`}
                </span>
              </div>
              <div className="module-card-title">{mod.title}</div>
              <div className="module-card-desc">{mod.desc}</div>
            </div>
          </a>
        ))}
      </div>

      {/* Stats row */}
      {/* <div style={{ marginTop: '28px', padding: '18px 20px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {[
          { label: 'Modules Total', value: '6'           },
          { label: 'Live Now',      value: String(liveMods) },
          { label: 'Current Phase', value: '8/8'           },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '26px', fontWeight: 600, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{s.value}</div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' }}>{s.label}</div>
          </div>
        ))}
      </div> */}
    </div>
  )
}
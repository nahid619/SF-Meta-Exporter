'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { id: 'picklist', icon: '📊', label: 'Picklist Exporter', href: '/dashboard/picklist',  enabled: true },
  { id: 'metadata', icon: '🔍', label: 'Metadata Exporter', href: '/dashboard/metadata',  enabled: true },
  { id: 'files',    icon: '📁', label: 'File Downloader',   href: '/dashboard/files',     enabled: true },
  { id: 'soql',     icon: '💻', label: 'SOQL Runner',       href: '/dashboard/soql',      enabled: true },
  { id: 'switch',   icon: '⚡', label: 'SF Switch',         href: '/dashboard/switch',    enabled: true },
  { id: 'reports',  icon: '📈', label: 'Report Exporter',   href: '/dashboard/reports',   enabled: true },
]

export default function Sidebar({ session }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const instanceShort = session?.instanceUrl
    ? session.instanceUrl.replace('https://', '').split('/')[0]
    : '—'

  const initials = session?.userInfo?.displayName
    ? session.userInfo.displayName.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '??'

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  function navigate(href) {
    router.push(href)
    setOpen(false)
  }

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" aria-hidden>
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-7 14-5-5 1.4-1.4L12 14.2l7.6-7.6L21 8l-9 9Z"/>
            </svg>
          </div>
          <span className="sidebar-logo-text">SF Meta Exporter</span>
        </div>
        <div className="org-badge">
          <div className="org-badge-label">Connected org</div>
          <div className="org-badge-url" title={session?.instanceUrl}>{instanceShort}</div>
        </div>
      </div>

      {/* Navigation */}
      <div className="sidebar-nav">
        <div className="nav-section-label">Modules</div>
        {NAV_ITEMS.map(item => {
          const isActive = pathname?.startsWith(item.href)
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => navigate(item.href)}
              title={item.label}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span>{item.label}</span>
              <span className="nav-item-badge" style={{ background: 'var(--green-dim)', borderColor: 'var(--green)', color: '#6ee7b7' }}>
                ✓ Live
              </span>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        {session?.userInfo && (
          <div style={{ padding: '8px 10px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#bfdbfe', flexShrink: 0 }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: 'var(--text-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.userInfo.displayName || session.userInfo.username}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.userInfo.username}
              </div>
            </div>
          </div>
        )}
        <button className="btn-ghost" style={{ width: '100%' }} onClick={handleLogout}>
          ⬡ Disconnect
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — hidden below 768px */}
      <nav className="sidebar sidebar-desktop">
        {sidebarContent}
      </nav>

      {/* Mobile: top bar with hamburger */}
      <div className="sidebar-mobile-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="sidebar-logo-icon" style={{ width: '26px', height: '26px', borderRadius: '6px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden>
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-7 14-5-5 1.4-1.4L12 14.2l7.6-7.6L21 8l-9 9Z"/>
            </svg>
          </div>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-1)' }}>SF Meta Exporter</span>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle menu"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: '4px' }}
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99 }}
          />
          {/* Drawer */}
          <nav className="sidebar sidebar-drawer">
            {sidebarContent}
          </nav>
        </>
      )}
    </>
  )
}
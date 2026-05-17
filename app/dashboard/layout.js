import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import Sidebar from '@/components/Sidebar'
import StatusLog from '@/components/StatusLog'
import { ExportProvider } from '@/components/ExportProvider'

export const dynamic = 'force-dynamic'

/**
 * Dashboard layout — server component.
 *
 * Phase 2 change: wraps the content area with <ExportProvider> so that:
 *   - Module pages can push log lines via useExport() → useExportContext()
 *   - StatusLog reads those lines from context without any prop-drilling
 *
 * Structure:
 *   <div.dash-root>
 *     <Sidebar />                    ← outside ExportProvider (doesn't need logs)
 *     <ExportProvider>
 *       <div.dash-content>
 *         <header />
 *         <main>{children}</main>   ← module pages live here
 *         <StatusLog />             ← reads from ExportContext
 *       </div>
 *     </ExportProvider>
 *   </div>
 */
export default async function DashboardLayout({ children }) {
  const session = await getSession()
  if (!session.accessToken) redirect('/login')

  const publicSession = {
    instanceUrl: session.instanceUrl,
    orgType:     session.orgType,
    apiVersion:  session.apiVersion,
    userInfo:    session.userInfo || null,
  }

  return (
    <div className="dash-root">
      <Sidebar session={publicSession} />

      <ExportProvider>
        <div className="dash-content">

          {/* Top bar */}
          <header className="dash-topbar">
            <span style={{ fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              API v{session.apiVersion}
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-3)', marginLeft: '12px' }}>
              <span className="pulse-dot" />
              Connected
            </span>

            <div className="topbar-user">
              {publicSession.userInfo ? (
                <>
                  <span style={{ color: 'var(--text-2)' }}>
                    {publicSession.userInfo.displayName || publicSession.userInfo.username}
                  </span>
                  <div className="topbar-avatar">
                    {(publicSession.userInfo.displayName || publicSession.userInfo.username || '?')
                      .split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                </>
              ) : (
                <span style={{ color: 'var(--text-3)' }}>
                  {publicSession.instanceUrl?.replace('https://', '')}
                </span>
              )}
            </div>
          </header>

          {/* Module pages render here */}
          <main className="dash-main">
            {children}
          </main>

          {/* Status log — reads from ExportContext, auto-opens on new logs */}
          <StatusLog />

        </div>
      </ExportProvider>
    </div>
  )
}

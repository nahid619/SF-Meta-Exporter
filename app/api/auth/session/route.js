import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/session
 * Returns the current authentication status and public session data.
 * Never returns the raw accessToken.
 */
export async function GET() {
  const session = await getSession()

  if (!session.accessToken) {
    return NextResponse.json({ authenticated: false })
  }

  return NextResponse.json({
    authenticated: true,
    instanceUrl:   session.instanceUrl,
    orgType:       session.orgType,
    domain:        session.domain  || null,
    apiVersion:    session.apiVersion,
    userInfo:      session.userInfo || null,
  })
}

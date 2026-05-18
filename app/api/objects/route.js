import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { checkRateLimit, rateLimitResponse, QUERY_LIMIT } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/objects
 *
 * Returns all queryable, non-deprecated SObjects for the connected org.
 * Used by ObjectSelector to populate the object list.
 * Mirrors the _fetch_all_org_objects() call in salesforce_client.py.
 *
 * Response: { objects: string[] }
 */
export async function GET() {
  const session = await getSession()
  
  if (!session.accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rl = checkRateLimit(`${session.instanceUrl}:objects`, QUERY_LIMIT)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  try {
    const client  = SalesforceClient.fromSession(session)
    const objects = await client.getAllObjects()
    return NextResponse.json({ objects })
  } catch (err) {
    // Session expired — tell the client to re-authenticate
    if (err.code === 'SESSION_EXPIRED') {
      return NextResponse.json({ error: 'Session expired. Please reconnect.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
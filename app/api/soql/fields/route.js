/**
 * GET /api/soql/fields?object={ApiName}
 *
 * Returns all fields for an SObject — used by the Monaco autocomplete
 * provider to suggest field names when the cursor is after SELECT.
 *
 * Mirrors SOQLRunner._cache_object_metadata() in soql_runner.py.
 * The client caches the response per object so we only call this once
 * per object per session.
 */

import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const objectName       = searchParams.get('object')?.trim()

  if (!objectName) {
    return Response.json({ error: 'object param is required', fields: [] }, { status: 400 })
  }

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated', fields: [] }, { status: 401 })
  }

  try {
    const client  = SalesforceClient.fromSession(session)
    const desc    = await client.describeSObject(objectName)

    // Return the same shape as Python's field dict: name, label, type, referenceTo
    const fields = desc.fields.map(f => ({
      name:        f.name,
      label:       f.label,
      type:        f.type,
      referenceTo: f.referenceTo ?? [],
    }))

    return Response.json({ fields, objectLabel: desc.label })
  } catch (err) {
    return Response.json({ error: err.message, fields: [] })
  }
}

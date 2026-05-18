/**
 * POST /api/soql/execute
 *
 * Mirrors SOQLRunner.execute_query() from soql_runner.py.
 * Validates, runs, paginates, and cleans the Salesforce SOQL result.
 *
 * Body:   { soql: string }
 * Returns: { records, totalSize, count, elapsed } | { error, records:[], ... }
 *
 * Errors are returned as 200 (not 4xx) so the UI can display them inline —
 * same as the Python app surfacing Salesforce error messages in the status log.
 */

import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'

// Basic security: reject patterns that have no place in SOQL
const DANGEROUS = [/;/, /--/, /\/\*/, /\*\//, /\bEXECUTE?\b/i]

/**
 * Mirror _clean_records() in soql_runner.py exactly:
 *   - Strip `attributes` metadata keys
 *   - Flatten relationship fields: Owner → Owner.Name, Owner.Id …
 *   - Non-relationship dicts → JSON string
 */
function cleanRecords(records) {
  return records.map(record => {
    const clean = {}

    for (const [key, value] of Object.entries(record)) {
      if (key === 'attributes') continue

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if ('attributes' in value) {
          // Relationship result — flatten one level deep
          for (const [sub, subVal] of Object.entries(value)) {
            if (sub !== 'attributes') {
              clean[`${key}.${sub}`] = subVal
            }
          }
        } else {
          // Unexpected nested object — stringify (matches Python str(value))
          clean[key] = JSON.stringify(value)
        }
      } else {
        clean[key] = value
      }
    }

    return clean
  })
}

export async function POST(request) {
  const { soql } = await request.json()
  const query    = (soql ?? '').trim()

  // ── Validation (mirrors SOQLRunner.validate_query) ────────────────────────
  if (!query) {
    return Response.json({ error: 'Query cannot be empty', records: [], totalSize: 0, count: 0 })
  }
  if (!/\bSELECT\b/i.test(query)) {
    return Response.json({ error: 'Query must contain SELECT', records: [], totalSize: 0, count: 0 })
  }
  if (!/\bFROM\b/i.test(query)) {
    return Response.json({ error: 'Query must contain a FROM clause', records: [], totalSize: 0, count: 0 })
  }
  for (const pattern of DANGEROUS) {
    if (pattern.test(query)) {
      return Response.json({ error: 'Query contains invalid characters', records: [], totalSize: 0, count: 0 })
    }
  }

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated — please reconnect', records: [], totalSize: 0, count: 0 }, { status: 401 })
  }

  const startMs = Date.now()

  try {
    const client                 = SalesforceClient.fromSession(session)
    const { records, totalSize } = await client.queryAll(query)
    const cleaned                = cleanRecords(records)
    const elapsed                = ((Date.now() - startMs) / 1000).toFixed(2)

    return Response.json({
      records:   cleaned,
      totalSize,
      count:     cleaned.length,
      elapsed:   `${elapsed}s`,
      error:     null,
      apiUsage:  client.apiUsage ?? null,   // { used, total, remaining } — null if SF omitted the header
    })
  } catch (err) {
    // Surface Salesforce error messages directly — mirrors Python behaviour
    return Response.json({
      records:   [],
      totalSize: 0,
      count:     0,
      elapsed:   '—',
      error:     err.message,
    })
  }
}
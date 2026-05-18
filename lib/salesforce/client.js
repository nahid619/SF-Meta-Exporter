/**
 * SalesforceClient — server-side only.
 * Mirrors salesforce_client.py from the Python desktop app.
 * Never imported by client components.
 */

import { API_VERSION } from '@/lib/config'

export class SalesforceClient {
  constructor({ accessToken, instanceUrl, apiVersion = API_VERSION }) {
    this.accessToken = accessToken
    this.instanceUrl = instanceUrl.replace(/\/$/, '')
    this.apiVersion  = apiVersion
    this.baseUrl     = `${this.instanceUrl}/services/data/v${apiVersion}`
    this.headers     = {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
  }

  /** Reconstitute client from a stored session object */
  static fromSession(session) {
    if (!session?.accessToken || !session?.instanceUrl) {
      throw new Error('Invalid session — not authenticated')
    }
    return new SalesforceClient({
      accessToken: session.accessToken,
      instanceUrl: session.instanceUrl,
      apiVersion:  session.apiVersion || API_VERSION,
    })
  }

  /**
   * Detect the latest API version supported by this org.
   * Mirrors _fetch_org_api_version() in salesforce_client.py.
   * Falls back to API_VERSION constant on any error.
   */
  static async detectApiVersion(instanceUrl, accessToken) {
    try {
      const res = await fetch(`${instanceUrl.replace(/\/$/, '')}/services/data/`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const versions = await res.json()
        if (Array.isArray(versions) && versions.length > 0) {
          return versions[versions.length - 1].version
        }
      }
    } catch {}
    return API_VERSION
  }

  /**
   * Fetch all queryable, non-deprecated SObjects.
   * Mirrors _fetch_all_org_objects() in salesforce_client.py.
   * Returns sorted array of API names.
   */
  async getAllObjects() {
    const res = await this._get('/sobjects/')
    const sobjects = res.sobjects || []
    return sobjects
      .filter(o => o.queryable && !o.deprecatedAndHidden)
      .map(o => o.name)
      .sort()
  }

  /**
   * Describe a single SObject — returns all field metadata.
   */
  async describeSObject(objectName) {
    return this._get(`/sobjects/${objectName}/describe/`)
  }

  /**
   * Execute a SOQL query and follow all pagination links.
   * Mirrors query_all() pattern from the Python app.
   */
  async queryAll(soql) {
    const first = await this._get(`/query?q=${encodeURIComponent(soql)}`)
    let records = [...first.records]
    let next    = first.nextRecordsUrl

    while (next) {
      const page = await this._getAbsolute(`${this.instanceUrl}${next}`)
      records = [...records, ...page.records]
      next    = page.nextRecordsUrl || null
    }

    return { records, totalSize: first.totalSize }
  }

  /**
   * Tooling API GET.
   */
  async toolingGet(path) {
    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/tooling${path}`
    return this._getAbsolute(url)
  }

  /**
   * Tooling API query.
   */
  async toolingQuery(soql) {
    return this.toolingGet(`/query?q=${encodeURIComponent(soql)}`)
  }

  /**
   * Fetch the current user's info from /services/oauth2/userinfo.
   */
  async getUserInfo() {
    try {
      const res = await fetch(`${this.instanceUrl}/services/oauth2/userinfo`, {
        headers: this.headers,
      })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  async _get(path) {
    return this._getAbsolute(`${this.baseUrl}${path}`)
  }

  async _getAbsolute(url) {
    const res = await fetch(url, { headers: this.headers })

    // Salesforce returns "Sforce-Limit-Info: api-usage=1234/150000" on every response.
    // Capture it so callers can surface remaining quota without an extra round-trip.
    const limitHeader = res.headers.get('Sforce-Limit-Info')
    if (limitHeader) {
      const match = limitHeader.match(/api-usage=(\d+)\/(\d+)/)
      if (match) {
        this.apiUsage = {
          used:      parseInt(match[1], 10),
          total:     parseInt(match[2], 10),
          remaining: parseInt(match[2], 10) - parseInt(match[1], 10),
        }
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => [])
      const msg  = body[0]?.message || body.message || `HTTP ${res.status}`
      // Detect expired session — mirrors Python SalesforceExpiredSession handling
      if (res.status === 401) {
        throw Object.assign(new Error(`Session expired: ${msg}`), { code: 'SESSION_EXPIRED' })
      }
      throw new Error(msg)
    }
    return res.json()
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method:  'POST',
      headers: this.headers,
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => [])
      throw new Error(err[0]?.message || `HTTP ${res.status}`)
    }
    return res.json()
  }
}
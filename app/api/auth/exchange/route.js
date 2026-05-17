import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'

/**
 * POST /api/auth/exchange
 * Exchanges the Salesforce OAuth auth code for an access token.
 * Mirrors the token-exchange step in oauth_handler.py OAuthWebFlow.authenticate().
 *
 * Body: { code: string }
 * Returns: { success: true, instanceUrl: string } or { error: string }
 */
export async function POST(request) {
  const { code } = await request.json()

  const session = await getSession()

  if (!session.pkceVerifier || !session.consumerKey || !session.sfBaseUrl) {
    return NextResponse.json(
      { error: 'Session state is missing. Please start the login flow again.' },
      { status: 400 }
    )
  }

  if (!code?.trim()) {
    return NextResponse.json({ error: 'No authorization code provided.' }, { status: 400 })
  }

  // Must be identical to the redirect_uri sent in the initiate step.
  // We stored it in the session so both steps always use the exact same value.
  const redirectUri = session.redirectUri || 'http://localhost:3000/auth/callback'

  // Exchange auth code for tokens — mirrors requests.post in oauth_handler.py
  let tokenData
  try {
    const tokenRes = await fetch(`${session.sfBaseUrl}/services/oauth2/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code:          code.trim(),
        client_id:     session.consumerKey,
        redirect_uri:  redirectUri,
        code_verifier: session.pkceVerifier,
      }),
    })
    tokenData = await tokenRes.json()
  } catch (err) {
    return NextResponse.json(
      { error: `Network error contacting Salesforce: ${err.message}` },
      { status: 502 }
    )
  }

  // Salesforce error responses — mirrors error handling in oauth_handler.py
  if (tokenData.error) {
    const msg = tokenData.error_description || tokenData.error
    return NextResponse.json({ error: `Login error: ${msg}` }, { status: 400 })
  }

  if (!tokenData.access_token || !tokenData.instance_url) {
    return NextResponse.json(
      { error: 'Unexpected response from Salesforce. Missing access_token or instance_url.' },
      { status: 400 }
    )
  }

  // Detect the org's latest API version — mirrors _fetch_org_api_version()
  const apiVersion = await SalesforceClient.detectApiVersion(
    tokenData.instance_url,
    tokenData.access_token
  )

  // Fetch user info for display in the dashboard header
  let userInfo = null
  try {
    const client = new SalesforceClient({
      accessToken: tokenData.access_token,
      instanceUrl: tokenData.instance_url,
      apiVersion,
    })
    const raw = await client.getUserInfo()
    if (raw) {
      userInfo = {
        username:    raw.preferred_username || raw.email || '',
        displayName: raw.name || raw.preferred_username || '',
        email:       raw.email || '',
        userId:      raw.user_id || '',
      }
    }
  } catch {
    // Non-fatal — we still proceed without user info
  }

  // Persist to session — clear the temporary pkceVerifier
  session.accessToken  = tokenData.access_token
  session.instanceUrl  = tokenData.instance_url
  session.apiVersion   = apiVersion
  session.userInfo     = userInfo
  session.pkceVerifier = undefined   // clear after use
  await session.save()

  return NextResponse.json({
    success:     true,
    instanceUrl: tokenData.instance_url,
    apiVersion,
  })
}

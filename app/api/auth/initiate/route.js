import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { ORG_URLS } from '@/lib/config'
import crypto from 'crypto'

function generatePKCEPair() {
  const verifier  = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function normaliseCustomDomain(raw) {
  let host = raw.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
  if (!host.includes('.salesforce.com') && !host.includes('.force.com')) {
    host = `${host}.salesforce.com`
  }
  return `https://${host}`
}

/**
 * Build the redirect URI from the actual incoming request — no env var needed.
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL env var (explicit override, useful for production)
 *   2. Origin header (always sent by browsers in POST requests — most reliable)
 *   3. Host header (fallback for non-browser clients)
 */
function buildRedirectUri(request) {
  // 1. Explicit env var override
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (envUrl) {
    const uri = `${envUrl}/auth/callback`
    console.log('[auth/initiate] redirect_uri (from env):', uri)
    return uri
  }

  // 2. Origin header — browsers always send this on cross-origin POST requests
  const origin = request.headers.get('origin')
  if (origin) {
    const uri = `${origin}/auth/callback`
    console.log('[auth/initiate] redirect_uri (from Origin header):', uri)
    return uri
  }

  // 3. Host header fallback
  const host    = request.headers.get('host') || 'localhost:3000'
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto   = fwdProto ?? (isLocal ? 'http' : 'https')
  const uri     = `${proto}://${host}/auth/callback`
  console.log('[auth/initiate] redirect_uri (from Host header):', uri)
  return uri
}

export async function POST(request) {
  const { consumerKey, orgType, domain, forceLogin } = await request.json()

  if (!consumerKey?.trim()) {
    return NextResponse.json(
      { error: 'Consumer Key is required.' },
      { status: 400 }
    )
  }

  let sfBaseUrl
  if (orgType === 'custom') {
    if (!domain?.trim()) {
      return NextResponse.json({ error: 'Custom domain is required.' }, { status: 400 })
    }
    sfBaseUrl = normaliseCustomDomain(domain)
  } else {
    sfBaseUrl = ORG_URLS[orgType] ?? ORG_URLS.production
  }

  const redirectUri         = buildRedirectUri(request)
  const { verifier, challenge } = generatePKCEPair()

  // Force Salesforce to show the login form even if there's an active session
  // cookie. This is the root-cause fix for "after a failed attempt with a
  // mismatched org/key, retrying immediately fails again without ever showing
  // the login form". prompt=login is OAuth 2.0 standard and SF honours it.
  //
  // We always send it by default. The client can opt out with forceLogin: false
  // if you ever want browser-cached SSO behaviour.
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             consumerKey.trim(),
    redirect_uri:          redirectUri,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  })
  if (forceLogin !== false) {
    params.set('prompt', 'login')
  }

  const authUrl = `${sfBaseUrl}/services/oauth2/authorize?${params.toString()}`

  const session         = await getSession()
  session.pkceVerifier  = verifier
  session.consumerKey   = consumerKey.trim()
  session.orgType       = orgType
  session.domain        = domain || null
  session.sfBaseUrl     = sfBaseUrl
  session.redirectUri   = redirectUri   // ← store so exchange route uses the same one
  session.accessToken   = undefined
  session.instanceUrl   = undefined
  session.apiVersion    = undefined
  session.userInfo      = undefined
  await session.save()

  return NextResponse.json({ authUrl, redirectUri })
}

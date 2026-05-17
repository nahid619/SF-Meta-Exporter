import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'

export const sessionOptions = {
  // Must be at least 32 chars. Set SESSION_SECRET in .env.local
  password: process.env.SESSION_SECRET || 'dev-fallback-password-change-in-production-32ch',
  cookieName: 'sfmeta_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
}

/**
 * Get the current iron-session from request cookies.
 * Works in both Server Components (page.js) and Route Handlers (route.js).
 *
 * Session shape:
 * {
 *   consumerKey:  string   — SF External Client App consumer key
 *   orgType:      string   — 'production' | 'sandbox' | 'custom'
 *   domain:       string?  — custom domain, e.g. "myco.my.salesforce.com"
 *   sfBaseUrl:    string   — resolved SF auth base URL
 *   accessToken:  string   — SF OAuth access token
 *   instanceUrl:  string   — e.g. "https://myco.my.salesforce.com"
 *   apiVersion:   string   — e.g. "64.0"
 *   userInfo:     object?  — { username, displayName, email }
 *   pkceVerifier: string?  — temporary; cleared after token exchange
 * }
 */
export async function getSession() {
  // Next.js 15 breaking change: cookies() is now async — must be awaited.
  // In Next.js 14 it was synchronous. This one change is all that's needed
  // for full Next.js 15 compatibility across all route handlers and pages.
  const cookieStore = await cookies()
  return getIronSession(cookieStore, sessionOptions)
}

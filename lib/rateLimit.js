/**
 * In-memory sliding-window rate limiter.
 *
 * Two tiers:
 *   QUERY_LIMIT  — 30 req/min  for lightweight SF calls (SOQL, field lists, object lists)
 *   EXPORT_LIMIT —  5 req/min  for heavy export routes that burn many SF API calls
 *
 * Key: session.instanceUrl — one bucket per SF org (= one bucket per user in this app).
 *
 * Per-instance caveat: same as the job store — on Vercel, a user hitting two warm
 * instances gets two independent buckets, so the effective limit is (limit × instances).
 * That's acceptable for a defensive guard. When Redis lands in Phase 7, replace the
 * Map here with an Upstash sliding-window for true cross-instance enforcement.
 */

if (!globalThis.__sfmeta_rate_buckets) {
  globalThis.__sfmeta_rate_buckets = new Map()
}
const buckets = globalThis.__sfmeta_rate_buckets

export const QUERY_LIMIT  = { limit: 60, windowMs: 60_000 }
export const EXPORT_LIMIT = { limit: 20, windowMs: 60_000 }

/**
 * Check whether a key is within its rate limit window.
 *
 * @param {string} key        — unique bucket identifier (instanceUrl)
 * @param {{ limit: number, windowMs: number }} options
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
export function checkRateLimit(key, { limit, windowMs }) {
  const now      = Date.now()
  const existing = buckets.get(key)

  // Reset bucket if the window has rolled over
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  const resetAt = existing.windowStart + windowMs

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt }
  }

  existing.count++
  return { allowed: true, remaining: limit - existing.count, resetAt }
}

/**
 * Build a 429 Response with a Retry-After header.
 * Drop-in return value for any route handler.
 *
 * @param {number} resetAt — ms timestamp when the window resets
 */
export function rateLimitResponse(resetAt) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  return Response.json(
    { error: `Rate limit exceeded. Try again in ${retryAfter}s.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
// Remove stale buckets every 5 minutes so the Map doesn't grow unbounded.
if (!globalThis.__sfmeta_rate_cleanup) {
  globalThis.__sfmeta_rate_cleanup = setInterval(() => {
    const cutoff = Date.now() - 5 * 60_000
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.windowStart < cutoff) buckets.delete(key)
    }
  }, 5 * 60_000)
}
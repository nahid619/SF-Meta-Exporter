/**
 * Retry with exponential backoff.
 * Mirrors the retry pattern in the Python app's salesforce_client.py.
 *
 * Default: 3 attempts, backoff 1s → 2s → 4s.
 * Auto-retries on: 503 (Service Unavailable), 429 (Rate Limit), network errors.
 * Does NOT retry on: 4xx client errors (except 429).
 */

import { SalesforceRateLimitError } from './errors.js'

const RETRY_STATUS = new Set([429, 503, 502, 504])

/**
 * @param {() => Promise<T>} fn          — async function to retry
 * @param {object}           opts
 * @param {number}           opts.maxAttempts — default 3
 * @param {number}           opts.baseDelay   — ms, default 1000
 * @param {function}         opts.onRetry     — called before each retry (attempt, error)
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay   = opts.baseDelay   ?? 1000
  const onRetry     = opts.onRetry     ?? null

  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // Don't retry auth errors or non-retryable API errors
      if (err.code === 'SESSION_EXPIRED') throw err
      if (err.status && !RETRY_STATUS.has(err.status)) throw err

      // Last attempt — give up
      if (attempt === maxAttempts) break

      const delay = baseDelay * Math.pow(2, attempt - 1) // 1s, 2s, 4s
      const waitMs = err instanceof SalesforceRateLimitError
        ? (err.retryAfter ?? 30) * 1000
        : delay

      if (onRetry) onRetry(attempt, err, waitMs)

      await sleep(waitMs)
    }
  }

  throw lastError
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

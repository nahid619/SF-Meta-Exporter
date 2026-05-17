/**
 * In-memory job result store.
 *
 * Holds completed export buffers between:
 *   (a) the SSE stream finishing  →  (b) the user clicking Download
 *
 * Why a global Map works here:
 *   - Next.js dev server is a single Node process — Map persists across requests.
 *   - On Vercel (production), most exports complete within one function invocation.
 *     The download request hits the same warm instance within a few seconds.
 *   - Phase 7 (trigger deployment, 5–15 min) will add Upstash Redis for true
 *     cross-instance persistence. That's the only module that needs it.
 *
 * Auto-TTL: results are deleted after 15 minutes to avoid memory leaks.
 */

/** @type {Map<string, { buffer: Buffer, filename: string, contentType: string, createdAt: number }>} */
// Attach to globalThis so the Map survives Next.js HMR module re-evaluations in dev.
// In production this is just a normal module-level singleton.
if (!globalThis.__sfmeta_job_store) {
  globalThis.__sfmeta_job_store = new Map()
}
const store = globalThis.__sfmeta_job_store

const TTL_MS = 15 * 60 * 1000 // 15 minutes

/** Generate a short unique job ID */
export function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Store a completed export result.
 * @param {string} jobId
 * @param {{ buffer: Buffer, filename: string, contentType: string }} result
 */
export function storeResult(jobId, { buffer, filename, contentType }) {
  store.set(jobId, { buffer, filename, contentType, createdAt: Date.now() })
  // Auto-cleanup after TTL
  setTimeout(() => store.delete(jobId), TTL_MS)
}

/**
 * Retrieve a result. Returns null if not found or expired.
 * @param {string} jobId
 */
export function getResult(jobId) {
  return store.get(jobId) ?? null
}

/** Delete a result immediately (e.g. after download to free memory) */
export function deleteResult(jobId) {
  store.delete(jobId)
}

/** Current store size — useful for debugging */
export function storeSize() {
  return store.size
}
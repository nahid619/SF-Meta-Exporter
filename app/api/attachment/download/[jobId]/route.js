// FILE PATH: app/api/attachment/download/[jobId]/route.js
import { getResult } from '@/lib/jobs/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/attachment/download/[jobId]
 *
 * Fallback download route for self-hosted deployments that use the job store.
 * On Vercel the attachment/export route delivers the ZIP inline via base64
 * in the SSE done event (zipBase64) so this route is rarely hit in production.
 *
 * Serves the completed ZIP containing:
 *   Attachments/             ← all downloaded legacy attachment bodies
 *   attachment_manifest.csv  ← DataLoader-compatible CSV with full metadata
 */
export async function GET(request, { params }) {
  const { jobId } = await params
  const result    = getResult(jobId)

  if (!result) {
    return Response.json(
      { error: 'File not found. The export may have expired (15-min window) or failed.' },
      { status: 404 },
    )
  }

  return new Response(result.buffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
      'Content-Length':      String(result.buffer.byteLength ?? result.buffer.length),
      'Cache-Control':       'no-store',
    },
  })
}
// app/api/backup/download/[jobId]/route.js

/**
 * GET /api/backup/download/[jobId]
 *
 * Serves the completed backup ZIP from the in-memory job store.
 * Identical pattern to all other download routes in the project.
 */

import { getResult } from '@/lib/jobs/store'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { jobId } = await params
  const result    = getResult(jobId)

  if (!result) {
    return Response.json(
      { error: 'Backup file not found. The export may have expired (15-min window) or did not complete.' },
      { status: 404 }
    )
  }

  return new Response(result.buffer, {
    status: 200,
    headers: {
      'Content-Type':        result.contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
      'Content-Length':      String(result.buffer.byteLength ?? result.buffer.length),
      'Cache-Control':       'no-store',
    },
  })
}

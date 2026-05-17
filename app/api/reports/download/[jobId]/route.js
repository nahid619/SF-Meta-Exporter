import { getResult } from '@/lib/jobs/store'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { jobId } = await params
  const result    = getResult(jobId)

  if (!result) {
    return Response.json(
      { error: 'File not found. The export may have expired (15-min window) or failed.' },
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

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

/** POST /api/auth/logout — destroys the session cookie */
export async function POST() {
  const session = await getSession()
  session.destroy()
  return NextResponse.json({ success: true })
}

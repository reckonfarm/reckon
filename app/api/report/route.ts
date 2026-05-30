import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

const REASONS = ['spam', 'scam', 'sold', 'inappropriate', 'wrong_info', 'other'] as const
type Reason = (typeof REASONS)[number]

const NOTE_MAX = 2000

// Optional auth: capture reporter_user_id if a session exists, but never reject anon.
async function getOptionalUserId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

// POST /api/report — report a hay listing. Accepts anonymous or authed reporters.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const listing_id = Number(body.listing_id)
  if (!Number.isInteger(listing_id) || listing_id <= 0) {
    return Response.json({ error: 'listing_id (positive integer) is required' }, { status: 400 })
  }

  const rawReason = typeof body.reason === 'string' ? body.reason : null
  if (!rawReason || !(REASONS as readonly string[]).includes(rawReason)) {
    return Response.json({ error: 'A valid reason is required' }, { status: 400 })
  }
  const reason = rawReason as Reason

  const note =
    typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''

  // user_agent is captured server-side, never trusted from the client body.
  const user_agent = request.headers.get('user-agent')?.slice(0, 1024) ?? null

  const reporter_user_id = await getOptionalUserId()

  const db = createServiceClient()
  const { error } = await db.from('listing_reports').insert({
    listing_id,
    reporter_user_id,
    reason,
    note: note || null,
    user_agent,
  })

  if (error) {
    // FK violation (unknown listing) or any insert failure.
    return Response.json({ error: 'Could not file report' }, { status: 400 })
  }

  return Response.json({ ok: true })
}

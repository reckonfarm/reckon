import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// Demand probe — a free "Notify me" tap on an upcoming feature. Writes through
// the service-role client (no public RLS policy), mirroring /api/feedback.
// Anonymous taps are welcome; we just capture whatever identity we can.

const FEATURE_KEYS = [
  'lfp_alerts',
  'cattle_dashboard',
  'hay_hauler',
] as const
type FeatureKey = (typeof FEATURE_KEYS)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Optional auth: capture the user if a session exists, but never reject anon.
async function getOptionalUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user ? { id: user.id, email: user.email ?? null } : null
  } catch {
    return null
  }
}

// POST /api/feature-interest — record interest in an upcoming feature.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const rawKey = typeof body.feature_key === 'string' ? body.feature_key : ''
  if (!(FEATURE_KEYS as readonly string[]).includes(rawKey)) {
    return Response.json({ error: 'Unknown feature' }, { status: 400 })
  }
  const feature_key = rawKey as FeatureKey

  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 60) || null : null

  const user = await getOptionalUser()

  // Prefer the authenticated email; otherwise accept a sanitized client email.
  let email: string | null = user?.email ?? null
  if (!email) {
    const raw = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : ''
    email = EMAIL_RE.test(raw) ? raw : null
  }

  const db = createServiceClient()
  // Duplicates are allowed by design — every tap is demand signal; the UI blocks
  // re-tapping within a session.
  const { error } = await db.from('feature_interest').insert({
    user_id: user?.id ?? null,
    email,
    feature_key,
    source,
  })

  if (error) {
    return Response.json({ error: 'Could not save your interest' }, { status: 500 })
  }

  return Response.json({ ok: true })
}

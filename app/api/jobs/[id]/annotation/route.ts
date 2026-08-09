import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// PATCH /api/jobs/[id]/annotation —
//   { name?: string | null, machine?: string | null, dismissed?: boolean,
//     actual_bale_count?: number | null, actual_acres?: number | null }
//
// Annotations live in job_annotations (037), keyed by the stable job id —
// never in jobs, which the deriver rewrites wholesale. The user verb is
// dismiss (reversible), never delete: a deleted derived row would simply
// reappear on the next cron.
//
// Everything runs on the user-scoped SSR client so the 037 RLS policies are
// exercised, not bypassed (same doctrine as the /jobs pages). Reading the job
// first does double duty: it authorizes (036 SELECT is ranch-scoped) and
// supplies the ranch_id the annotation is stamped with.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { data: job } = await supabase
    .from('jobs')
    .select('id, ranch_id')
    .eq('id', id)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    if (body.name !== null && typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name must be a string or null' }, { status: 400 })
    }
    update.name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) || null : null
  }
  if ('machine' in body) {
    if (body.machine !== null && typeof body.machine !== 'string') {
      return NextResponse.json({ error: 'machine must be a string or null' }, { status: 400 })
    }
    // Lowercased by convention ('baler', 'swather', …) — detection queries
    // compare exact values, and case must never be why a label doesn't match.
    update.machine =
      typeof body.machine === 'string' ? body.machine.trim().toLowerCase().slice(0, 40) || null : null
  }
  if ('dismissed' in body) {
    if (typeof body.dismissed !== 'boolean') {
      return NextResponse.json({ error: 'dismissed must be a boolean' }, { status: 400 })
    }
    update.dismissed_at = body.dismissed ? new Date().toISOString() : null
  }
  // Actuals (039) — operator-reported ground truth. Null clears ("not
  // reported"), never zero-fills; bounds mirror the column CHECKs so a typo'd
  // 34000 bounces here with a message instead of as a constraint error.
  if ('actual_bale_count' in body) {
    const v = body.actual_bale_count
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000)) {
      return NextResponse.json({ error: 'actual_bale_count must be a whole number 0–10000, or null' }, { status: 400 })
    }
    update.actual_bale_count = v
  }
  if ('actual_acres' in body) {
    const v = body.actual_acres
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10000)) {
      return NextResponse.json({ error: 'actual_acres must be a number 0–10000, or null' }, { status: 400 })
    }
    update.actual_acres = v === null ? null : Math.round(v * 10) / 10
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabase.from('job_annotations').upsert({
    job_id: job.id,
    user_id: user.id,
    ranch_id: job.ranch_id,
    ...update,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ─── Hay Opportunity Score v0 — precip → score snapshot (Phase A step 4) ─────────
//
// Runs OFF Vercel — a sibling step in the prism-ingest GitHub Actions job, AFTER the
// aggregate step. Reads each county's precip percent-of-normal from hay_score_inputs,
// maps it to a 0–100 v0 score, and SNAPSHOTS it into public.hay_score with an as-of
// stamp — mirroring the LFP weekly-snapshot pattern (lfp_eligibility_snapshots:
// week_date + capture_source). Idempotent on (fips, snapshot_date): same-day re-runs
// overwrite, later runs accumulate as re-scoring history.
//
// This proves the SNAPSHOT path, NOT the equation. The mapping is the deliberately-dumb
// v0: normal (100% of normal) → 50, dry below, wet above, no flat wet tail.
//   score = round( clamp(pct_of_normal, 0, 200) / 2 )      [NULL pct → NULL score, never 0]
// No phenology, no ceiling, no freeze/heat (later commits). No map/render change (Commit 5).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The exact mapping, recorded in every row's `source` so the snapshot self-documents
// (and a future phenology score is a visibly different source string).
const SOURCE = 'v0 precip percent-of-normal · round(clamp(pct,0,200)/2)'
const SENTINELS = new Set(['30069', '31109', '46033']) // logged for verification

// v0 score: NULL-honest (no usable precip → no score, never a fabricated 0).
function scoreFromPct(pct: number | null): number | null {
  if (pct == null) return null
  return Math.round(Math.min(Math.max(pct, 0), 200) / 2)
}

interface InputRow {
  fips: string
  county_name: string | null
  season_year: number
  season_label: string
  pct_of_normal: number | null
  is_provisional: boolean
  months_used: string[] | null
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in prism-score') } }
  const db: SupabaseClient = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  // snapshot_date is the HISTORY KEY ONLY — how snapshots accumulate over time. It is NOT
  // the user-facing freshness signal (that derives from the data: season_label / months_used /
  // is_provisional, surfaced by /api/hay-score). Never present snapshot_date as the "as of".
  const snapshotDate = new Date().toISOString().slice(0, 10)

  const { data, error } = await db
    .from('hay_score_inputs')
    .select('fips, county_name, season_year, season_label, pct_of_normal, is_provisional, months_used')
  if (error) { console.error('[prism-score] read hay_score_inputs failed:', error.message); process.exit(1) }
  const inputs = (data ?? []) as InputRow[]
  if (inputs.length === 0) { console.error('[prism-score] hay_score_inputs is empty — aborting'); process.exit(1) }

  let nullScore = 0
  const rows = inputs.map(r => {
    const score = scoreFromPct(r.pct_of_normal)
    if (score == null) nullScore++
    return {
      fips: r.fips,
      snapshot_date: snapshotDate,
      season_year: r.season_year,
      season_label: r.season_label,
      score,
      pct_of_normal: r.pct_of_normal,
      is_provisional: r.is_provisional,
      months_used: r.months_used,
      capture_source: 'live',
      source: SOURCE,
    }
  })

  for (const r of inputs) {
    if (SENTINELS.has(r.fips)) {
      console.log(
        `[prism-score] ${r.fips} ${r.county_name ?? ''}: ` +
        `pct=${r.pct_of_normal != null ? Math.round(r.pct_of_normal) + '%' : 'NULL'} → ` +
        `score=${scoreFromPct(r.pct_of_normal) ?? 'NULL'}`,
      )
    }
  }

  const { error: upErr } = await db.from('hay_score').upsert(rows, { onConflict: 'fips,snapshot_date' })
  if (upErr) { console.error('[prism-score] upsert failed:', upErr.message); process.exit(1) }

  console.log(`[prism-score] done — snapshot ${snapshotDate}: ${rows.length} counties scored (${nullScore} NULL score)`)
  if (rows.length === 0) process.exit(1)
}

main().catch(err => { console.error('[prism-score] threw:', err); process.exit(1) })

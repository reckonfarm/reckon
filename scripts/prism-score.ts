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
const SOURCE = 'precip round(clamp(pct,0,200)/2) × ceiling C × stage-weighted freeze (heat pending Commit 9)'
const SENTINELS = new Set(['30069', '31109', '46033']) // logged for verification

// Precip base: NULL-honest (no usable precip → no score, never a fabricated 0).
function scoreFromPct(pct: number | null): number | null {
  if (pct == null) return null
  return Math.round(Math.min(Math.max(pct, 0), 200) / 2)
}

// Apply the ceiling. ceiling_c NULL = "couldn't compute" → precip-only (NOT a fake cap).
// A real ceiling_c (incl. 1.00) caps: round(C × precip). C only caps, never boosts.
function applyCeiling(precip: number | null, ceiling: number | null): number | null {
  if (precip == null) return null
  if (ceiling == null) return precip
  return Math.round(ceiling * precip)
}

// Apply the stage-weighted freeze multiplier (from hay_gdd_spine). NULL = "couldn't compute"
// (no spine/temp) → no penalty (NOT a fake "no freeze"). A real 1.00 = freezes seen but none
// in a weighted stage, OR no freeze at all (e.g. Sheridan dodged the May frosts by greening up
// late). Freeze only penalizes (≤1), never boosts. Forward-consistent with the spec's
// min(frost, heat) once heat lands (Commit 9).
function applyFrost(score: number | null, frost: number | null): number | null {
  if (score == null) return null
  if (frost == null) return score
  return Math.round(frost * score)
}

interface InputRow {
  fips: string
  county_name: string | null
  season_year: number
  season_label: string
  pct_of_normal: number | null
  ceiling_c: number | null
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
    .select('fips, county_name, season_year, season_label, pct_of_normal, ceiling_c, is_provisional, months_used')
  if (error) { console.error('[prism-score] read hay_score_inputs failed:', error.message); process.exit(1) }
  const inputs = (data ?? []) as InputRow[]
  if (inputs.length === 0) { console.error('[prism-score] hay_score_inputs is empty — aborting'); process.exit(1) }

  // Stage-weighted freeze multiplier from the spine (gridMET-derived). NULL per fips = no penalty.
  const { data: spine, error: e2 } = await db.from('hay_gdd_spine').select('fips, frost_multiplier')
  if (e2) { console.error('[prism-score] read hay_gdd_spine failed:', e2.message); process.exit(1) }
  const frostByFips = new Map<string, number | null>()
  for (const s of spine ?? []) frostByFips.set(s.fips as string, (s.frost_multiplier as number | null) ?? null)

  let nullScore = 0
  const rows = inputs.map(r => {
    const frost = frostByFips.get(r.fips) ?? null
    const score = applyFrost(applyCeiling(scoreFromPct(r.pct_of_normal), r.ceiling_c), frost)
    if (score == null) nullScore++
    return {
      fips: r.fips,
      snapshot_date: snapshotDate,
      season_year: r.season_year,
      season_label: r.season_label,
      score,
      pct_of_normal: r.pct_of_normal,
      ceiling_c: r.ceiling_c,
      frost_multiplier: frost,
      is_provisional: r.is_provisional,
      months_used: r.months_used,
      capture_source: 'live',
      source: SOURCE,
    }
  })

  for (const r of inputs) {
    if (SENTINELS.has(r.fips)) {
      const precip = scoreFromPct(r.pct_of_normal)
      const frost = frostByFips.get(r.fips) ?? null
      const cScore = applyCeiling(precip, r.ceiling_c)
      console.log(
        `[prism-score] ${r.fips} ${r.county_name ?? ''}: ` +
        `precip=${precip ?? 'NULL'} × C=${r.ceiling_c != null ? r.ceiling_c.toFixed(2) : 'NULL'} ` +
        `× frost=${frost != null ? frost.toFixed(2) : 'NULL'} → final=${applyFrost(cScore, frost) ?? 'NULL'}`,
      )
    }
  }

  const { error: upErr } = await db.from('hay_score').upsert(rows, { onConflict: 'fips,snapshot_date' })
  if (upErr) { console.error('[prism-score] upsert failed:', upErr.message); process.exit(1) }

  console.log(`[prism-score] done — snapshot ${snapshotDate}: ${rows.length} counties scored (${nullScore} NULL score)`)
  if (rows.length === 0) process.exit(1)
}

main().catch(err => { console.error('[prism-score] threw:', err); process.exit(1) })

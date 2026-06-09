// ─── gridMET GDD spine upsert (Phase B Commit 6 — write step) ────────────────────
//
// Reads the per-county GDD JSON emitted by scripts/gridmet-gdd.py and upserts it into
// public.hay_gdd_spine via supabase-js (same idiom as the prism-* scripts). The compute
// lives in Python (netCDF/OPeNDAP + geospatial); this keeps the DB write in the
// established pattern and lets the JSON be eyeballed before it lands.
//
//   usage: npx tsx scripts/gridmet-gdd-upsert.ts <path-to-json>
//
// Spine only — does NOT touch hay_score, /api/hay-score, or the map. Idempotent on fips.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const SOURCE = 'gridMET 4km daily tmin/tmax/vpd/vs · GDD base 41°F cap 86°F · stage ladder LITERATURE + stage-weighted freeze + heat (VPD≥1.5kPa, wind-amp) — all contested'
const SENTINELS = new Set(['30069', '31109', '46033'])

interface SpineRow {
  fips: string
  season_year: number
  gdd_cumulative: number | null
  stage: string | null
  green_up_date: string | null
  days_used: number
  as_of_date: string | null
  is_provisional: boolean
  frost_multiplier: number | null
  freeze_days: number | null
  worst_freeze_stage: string | null
  heat_multiplier: number | null
  heat_days: number | null
  worst_heat_stage: string | null
}

async function main() {
  const path = process.argv[2]
  if (!path) { console.error('[gdd-upsert] usage: tsx gridmet-gdd-upsert.ts <json>'); process.exit(1) }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  const payload = JSON.parse(readFileSync(path, 'utf8')) as { as_of: string | null; season_year: number; rows: SpineRow[] }
  const rows = payload.rows ?? []
  if (rows.length === 0) { console.error('[gdd-upsert] no rows in JSON — aborting'); process.exit(1) }

  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in gdd-upsert') } }
  const db: SupabaseClient = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  const upserts = rows.map(r => ({
    fips: r.fips,
    season_year: r.season_year,
    gdd_cumulative: r.gdd_cumulative,
    stage: r.stage,
    green_up_date: r.green_up_date,
    days_used: r.days_used,
    as_of_date: r.as_of_date,
    is_provisional: r.is_provisional,
    frost_multiplier: r.frost_multiplier,
    freeze_days: r.freeze_days,
    worst_freeze_stage: r.worst_freeze_stage,
    heat_multiplier: r.heat_multiplier,
    heat_days: r.heat_days,
    worst_heat_stage: r.worst_heat_stage,
    source: SOURCE,
  }))

  for (const r of rows) {
    if (SENTINELS.has(r.fips)) {
      console.log(`[gdd-upsert] ${r.fips}: GDD=${r.gdd_cumulative ?? 'NULL'} stage=${r.stage ?? 'NULL'} green_up=${r.green_up_date ?? 'NULL'} ` +
        `frost_mult=${r.frost_multiplier ?? 'NULL'} freeze_days=${r.freeze_days ?? 'NULL'} worst=${r.worst_freeze_stage ?? 'NULL'} ` +
        `heat_mult=${r.heat_multiplier ?? 'NULL'} heat_days=${r.heat_days ?? 'NULL'} worst_heat=${r.worst_heat_stage ?? 'NULL'} days=${r.days_used}`)
    }
  }

  const nullGdd = rows.filter(r => r.gdd_cumulative == null).length
  const { error } = await db.from('hay_gdd_spine').upsert(upserts, { onConflict: 'fips' })
  if (error) { console.error('[gdd-upsert] upsert failed:', error.message); process.exit(1) }

  console.log(`[gdd-upsert] done — upserted ${upserts.length} counties (${nullGdd} NULL gdd) · as_of ${payload.as_of}`)
}

main().catch(err => { console.error('[gdd-upsert] threw:', err); process.exit(1) })

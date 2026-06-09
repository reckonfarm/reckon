// ─── Starting-condition ceiling C (Phase B, Commit 7b) ───────────────────────────
//
// Runs OFF Vercel — sibling step in the prism-ingest job, AFTER aggregate, BEFORE score.
// Computes a per-county ceiling C that caps the score by how the county ENTERED the season:
//
//   C = clamp( 0.5·antecedent_ppt_pct/100 + 0.5·usdm_cap , 0.15, 1.0 )
//
//   • antecedent_ppt_pct — Feb+Mar % of normal (proxy for Oct–Mar recharge), from aggregate.
//   • usdm_cap — from the USDM drought class AT GREEN-UP (hay_gdd_spine.green_up_date), read
//     from the REAL historical weekly USDM (week ≤ green-up date), batched ONE call per state.
//     Never today's class. CONTESTED expert table, calibration-pending.
//
// Writes ceiling_c + usdm_at_greenup onto hay_score_inputs; prism-score applies C as
// final = round(C × precip_score). C only caps (≤1.0), never boosts.
//
// HONEST-DEGRADED (distinct from 1.0): if green-up date is NULL (no temp / still pre-green-up)
// or antecedent/USDM can't be resolved → ceiling_c = NULL ("couldn't compute" → precip-only
// fallback in score), NEVER a fake 1.0. A computed ceiling_c = 1.00 is a REAL value meaning
// "entered with no effective cap" (e.g. a wet antecedent offsets a D1 entry).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// CONTESTED expert-judgment table (spec) — starting estimate, calibration-pending, NOT truth.
const USDM_CAP: Record<string, number> = { None: 1.0, D0: 0.90, D1: 0.75, D2: 0.55, D3: 0.35, D4: 0.20 }
const STATE_ABBR: Record<string, string> = { '30': 'MT', '38': 'ND', '46': 'SD', '56': 'WY', '31': 'NE' }
const SENTINELS = new Set(['30069', '31109', '46033'])
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function usdmClass(r: { d0: number; d1: number; d2: number; d3: number; d4: number }): string {
  if (r.d4 > 0) return 'D4'
  if (r.d3 > 0) return 'D3'
  if (r.d2 > 0) return 'D2'
  if (r.d1 > 0) return 'D1'
  if (r.d0 > 0) return 'D0'
  return 'None'
}

// One USDM call per state (all counties × all weeks in the range) → fips → weekly [{date, cls}].
async function fetchStateUsdm(abbr: string, start: string, end: string): Promise<Map<string, { date: string; cls: string }[]>> {
  const url = 'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent' +
    `?aoi=${abbr}&startdate=${start}&enddate=${end}&statisticsType=2`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`USDM ${abbr} ${res.status}`)
  const rows = (await res.json()) as Array<{ mapDate: string; fips: string; d0: string; d1: string; d2: string; d3: string; d4: string }>
  const byFips = new Map<string, { date: string; cls: string }[]>()
  for (const r of rows) {
    const fips = String(r.fips).padStart(5, '0')
    const cls = usdmClass({ d0: +r.d0, d1: +r.d1, d2: +r.d2, d3: +r.d3, d4: +r.d4 })
    if (!byFips.has(fips)) byFips.set(fips, [])
    byFips.get(fips)!.push({ date: r.mapDate.slice(0, 10), cls })
  }
  return byFips
}

// USDM class for the latest week on or before the green-up date.
function classAtGreenup(weeks: { date: string; cls: string }[] | undefined, greenUp: string): string | null {
  if (!weeks) return null
  let best: { date: string; cls: string } | null = null
  for (const w of weeks) {
    if (w.date <= greenUp && (best === null || w.date > best.date)) best = w
  }
  return best ? best.cls : null
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in prism-ceiling') } }
  const db: SupabaseClient = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  const year = new Date().getUTCFullYear()
  const seasonStart = `${year}-02-01`
  const today = new Date().toISOString().slice(0, 10)

  const { data: inputs, error: e1 } = await db
    .from('hay_score_inputs')
    .select('fips, state_fips, season_year, antecedent_ppt_pct')
  if (e1) { console.error('[prism-ceiling] read hay_score_inputs failed:', e1.message); process.exit(1) }
  if (!inputs || inputs.length === 0) { console.error('[prism-ceiling] hay_score_inputs empty — aborting'); process.exit(1) }

  const { data: spine, error: e2 } = await db.from('hay_gdd_spine').select('fips, green_up_date')
  if (e2) { console.error('[prism-ceiling] read hay_gdd_spine failed:', e2.message); process.exit(1) }
  const greenUpByFips = new Map<string, string | null>()
  for (const s of spine ?? []) greenUpByFips.set(s.fips as string, (s.green_up_date as string | null) ?? null)

  // One USDM call per state present in the inputs.
  const states = [...new Set(inputs.map(r => r.state_fips as string))]
  const usdmByState = new Map<string, Map<string, { date: string; cls: string }[]>>()
  for (const sf of states) {
    const abbr = STATE_ABBR[sf]
    if (!abbr) { console.error(`[prism-ceiling] unknown state_fips ${sf} — skipping`); continue }
    usdmByState.set(sf, await fetchStateUsdm(abbr, seasonStart, today))
    console.log(`[prism-ceiling] USDM ${abbr}: ${usdmByState.get(sf)!.size} counties`)
  }

  let computed = 0, nullCeil = 0
  const rows = inputs.map(r => {
    const fips = r.fips as string
    const greenUp = greenUpByFips.get(fips) ?? null
    const ante = r.antecedent_ppt_pct as number | null
    const usdm = greenUp ? classAtGreenup(usdmByState.get(r.state_fips as string)?.get(fips), greenUp) : null

    let ceiling: number | null = null
    if (greenUp != null && ante != null && usdm != null) {
      ceiling = clamp(0.5 * (ante / 100) + 0.5 * USDM_CAP[usdm], 0.15, 1.0)
      computed++
    } else {
      nullCeil++  // honest "couldn't compute" → precip-only in score, NOT a fake 1.0
    }
    if (SENTINELS.has(fips)) {
      console.log(`[prism-ceiling] ${fips}: green_up=${greenUp ?? 'NULL'} usdm@greenup=${usdm ?? 'NULL'} ` +
        `antecedent=${ante != null ? Math.round(ante) + '%' : 'NULL'} → C=${ceiling != null ? ceiling.toFixed(2) : 'NULL'}`)
    }
    return { fips, season_year: r.season_year, ceiling_c: ceiling, usdm_at_greenup: usdm }
  })

  const { error: upErr } = await db.from('hay_score_inputs').upsert(rows, { onConflict: 'fips' })
  if (upErr) { console.error('[prism-ceiling] upsert failed:', upErr.message); process.exit(1) }

  console.log(`[prism-ceiling] done — ${rows.length} counties: ${computed} ceilings computed, ${nullCeil} NULL (precip-only)`)
}

main().catch(err => { console.error('[prism-ceiling] threw:', err); process.exit(1) })

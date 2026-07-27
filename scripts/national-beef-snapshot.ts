// ─── National beef benchmark snapshot writer (cron / local seed) ─────────────────────
//
// Fetches the two national benchmark reports from USDA APIs and UPSERTS one row per
// (report_slug, metric, week_ending) into public.national_beef_snapshots (migration
// 032) — the Markets view's national card. PUBLIC reference data → SERVICE-ROLE client.
// Runs OFF the Vercel request path (GitHub Actions national-beef-snapshot.yml, or
// locally to seed). Mirrors scripts/mars-snapshot.ts (own client, idempotent upsert,
// --dry-run, heartbeat).
//
//   Local seed:  npx tsx scripts/national-beef-snapshot.ts
//   Dry run:     npx tsx scripts/national-beef-snapshot.ts --dry-run   (fetch+parse+print, write NOTHING)
//
// TWO APIs, BOTH USDA (discovered 2026-07-27, probed live):
//   • Datamart (mpr.datamart.ams.usda.gov, LMR, NO KEY) — the packer-reported fed-cattle
//     reports live here, NOT on marsapi. Report 2477 = 5 Area Weekly Weighted Average
//     Direct Slaughter Cattle (LM_CT150). Fields (probed): class_description,
//     selling_basis_description, grade_description, weighted_avg_price,
//     price_range_low/high, head_count (comma-strings), report_date MM/DD/YYYY.
//   • marsapi (existing AMS_MARS_API_KEY) — feeder AUCTION reports. The old national
//     feeder summary (SJ_LS850/"3232") exists on NO API (dashboard-only since Apr 2026),
//     so the national feeder read is the OKLAHOMA NATIONAL STOCKYARDS (slug 1280, OKC,
//     Mon sale) — the largest-volume benchmark feeder auction in the country. Labeled
//     honestly as the OKC benchmark, never "national average". Same auction schema as
//     the MT barns (avg_price / avg_weight / price_unit / receipts).
//
// CORRECTIONS: trailing LAST_DAYS window, every week upserted — USDA's post-publication
// corrections re-write their week's row instead of freezing. NEVER print the key.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Source config — slugs/URLs are CONFIG, not code (slug churn is documented
// reality; when a report dies the fix is here, one line, and the service degrades that
// metric to its honest stale/warming state in the meantime). ─────────────────────────
const LAST_DAYS = 35 // trailing correction window (~5 weekly publishes)
const SOURCES = {
  fed: {
    slug: '2477',
    name: '5 Area Weekly Weighted Average Direct Slaughter Cattle (LM_CT150)',
    url: `https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2477/Detail?lastDays=${LAST_DAYS}`,
    auth: false,
  },
  feeder: {
    slug: '1280',
    name: 'Oklahoma National Stockyards Feeder Cattle - Oklahoma City, OK',
    url: `https://marsapi.ams.usda.gov/services/v1.2/reports/1280?lastDays=${LAST_DAYS}`,
    auth: true,
  },
} as const

const REQ_TIMEOUT = 60_000
const KEY = process.env.AMS_MARS_API_KEY
if (!KEY) {
  console.error('Missing AMS_MARS_API_KEY — set it in .env.local (local) or as a CI secret.')
  process.exit(1)
}
const AUTH = 'Basic ' + Buffer.from(`${KEY}:`).toString('base64')
const DRY_RUN = process.argv.includes('--dry-run')

// ─── Coercion helpers (fields arrive as numbers OR comma'd numeric strings OR absent) ─
type Raw = Record<string, unknown>

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,\s]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}
// 'MM/DD/YYYY' or ISO → 'YYYY-MM-DD'; null if unparseable.
function dateIso(v: unknown): string | null {
  if (!v) return null
  const t = Date.parse(String(v).replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2'))
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

async function fetchRows(url: string, auth: boolean): Promise<Raw[]> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...(auth ? { Authorization: AUTH } : {}) },
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as unknown
  if (Array.isArray(body)) return body as Raw[]
  const b = body as Raw
  return Array.isArray(b.results) ? (b.results as Raw[]) : []
}

export interface MetricRow {
  report_slug: string
  metric: string
  week_ending: string
  value: number
  price_low: number | null
  price_high: number | null
  head_count: number | null
  as_of: string | null
}

// 2477 Detail — the canonical fed read: STEER / LIVE FOB / "Total all grades" →
// weighted_avg_price. One row per weekly report_date.
function parseFed(rows: Raw[]): MetricRow[] {
  const out: MetricRow[] = []
  for (const r of rows) {
    if (String(r.class_description ?? '').trim().toUpperCase() !== 'STEER') continue
    if (String(r.selling_basis_description ?? '').trim().toUpperCase() !== 'LIVE FOB') continue
    if (!/total all grades/i.test(String(r.grade_description ?? ''))) continue
    const value = toNum(r.weighted_avg_price)
    const week = dateIso(r.report_date)
    if (value == null || !week) continue
    out.push({
      report_slug: SOURCES.fed.slug, metric: 'fed_steer_live', week_ending: week, value,
      price_low: toNum(r.price_range_low), price_high: toNum(r.price_range_high),
      head_count: toNum(r.head_count) as number | null,
      as_of: dateIso(r.published_date) ?? week,
    })
  }
  return out
}

// 1280 OKC — feeder steers, Medium & Large frame, muscle grade 1 (the index-consistent
// spec), Per-Cwt rows only (excludes per-head bred/pair lots). Head-weighted average per
// sale date within the 500-599 and 700-799 bands.
function parseFeeder(rows: Raw[]): MetricRow[] {
  interface Acc { wsum: number; head: number; lo: number; hi: number }
  const acc = new Map<string, Acc>()
  for (const r of rows) {
    if (String(r.commodity ?? '') !== 'Feeder Cattle') continue
    if (String(r.class ?? '') !== 'Steers') continue
    if (String(r.price_unit ?? '') !== 'Per Cwt') continue
    if (!/medium and large/i.test(String(r.frame ?? ''))) continue
    if (String(r.muscle_grade ?? '').trim() !== '1') continue
    const w = toNum(r.avg_weight)
    const p = toNum(r.avg_price)
    const head = toNum(r.head_count) ?? 0
    const week = dateIso(r.report_date)
    if (w == null || p == null || head <= 0 || !week) continue
    const band = w >= 500 && w < 600 ? '500' : w >= 700 && w < 800 ? '700' : null
    if (!band) continue
    const k = `${week}|${band}`
    const a = acc.get(k) ?? { wsum: 0, head: 0, lo: Infinity, hi: -Infinity }
    a.wsum += p * head; a.head += head
    a.lo = Math.min(a.lo, toNum(r.avg_price_min) ?? p)
    a.hi = Math.max(a.hi, toNum(r.avg_price_max) ?? p)
    acc.set(k, a)
  }
  return [...acc.entries()].map(([k, a]) => {
    const [week, band] = k.split('|')
    return {
      report_slug: SOURCES.feeder.slug, metric: `feeder_steer_${band}`, week_ending: week,
      value: Math.round((a.wsum / a.head) * 100) / 100,
      price_low: a.lo === Infinity ? null : a.lo,
      price_high: a.hi === -Infinity ? null : a.hi,
      head_count: a.head, as_of: week,
    }
  })
}

// ─── Main ────────────────────────────────────────────────────────────────────────────
async function main() {
  const allRows: MetricRow[] = []
  for (const [kind, src] of Object.entries(SOURCES)) {
    let rows: Raw[]
    try {
      rows = await fetchRows(src.url, src.auth)
    } catch (err) {
      // One dead source must not kill the other's refresh.
      console.error(`  ${src.slug} (${kind}) fetch failed:`, err instanceof Error ? err.message : err)
      continue
    }
    const parsed = kind === 'fed' ? parseFed(rows) : parseFeeder(rows)
    console.log(`\n  ${src.slug} — ${src.name}\n  raw rows: ${rows.length} → parsed metric rows: ${parsed.length}`)
    for (const r of [...parsed].sort((a, b) => a.metric.localeCompare(b.metric) || a.week_ending.localeCompare(b.week_ending))) {
      console.log(`    ${r.metric} ${r.week_ending}: $${r.value}${r.price_low != null ? ` (${r.price_low}–${r.price_high})` : ''}${r.head_count ? ` · ${r.head_count.toLocaleString('en-US')} head` : ''}`)
    }
    allRows.push(...parsed)
  }

  // prior_value / change_pct from the adjacent prior week WITHIN this fetch window.
  const byMetric = new Map<string, MetricRow[]>()
  for (const r of allRows) {
    const list = byMetric.get(r.metric) ?? []
    list.push(r); byMetric.set(r.metric, list)
  }
  const upserts = allRows.map(r => {
    const prior = (byMetric.get(r.metric) ?? [])
      .filter(x => x.week_ending < r.week_ending)
      .sort((a, b) => b.week_ending.localeCompare(a.week_ending))[0] ?? null
    return {
      ...r,
      prior_value: prior?.value ?? null,
      change_pct: prior ? Math.round(((r.value - prior.value) / prior.value) * 1000) / 10 : null,
      source: 'USDA AMS Market News',
    }
  })

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would upsert ${upserts.length} rows. Nothing written.`)
    return
  }
  if (upserts.length === 0) {
    console.error('Parsed 0 rows from every source — refusing to write nothing. Check slugs/fields.')
    process.exit(1)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime disabled in national-beef-snapshot') } }
  const db = createClient(url, svc, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  const { data, error } = await db
    .from('national_beef_snapshots')
    .upsert(upserts, { onConflict: 'report_slug,metric,week_ending' })
    .select('id')
  if (error) throw new Error(`upsert failed (nothing written): ${error.message}`)
  console.log(`\ndone — upserted ${data?.length ?? 0} rows (idempotent on slug+metric+week).`)
}

main().catch(err => {
  console.error('\n  error:', err.message)
  process.exit(1)
})

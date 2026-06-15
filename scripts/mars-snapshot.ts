// ─── MARS auction price snapshot writer (cron / local seed) ──────────────────────────
//
// Fetches the fresh anchor barns from the USDA AMS Market News API (marsapi) and UPSERTS
// one row per barn into public.mars_price_snapshots (migration 024) — the herd Zestimate's
// price source. PUBLIC reference data, so it writes with the SERVICE-ROLE client (never the
// SSR/anon client). Runs OFF the Vercel request path (GitHub Actions — the Azure-IP probe
// confirmed marsapi is reachable from runners, unlike RMA; or locally to seed). Mirrors
// scripts/news-snapshot.ts (own client, idempotent upsert, --dry-run, ingested_at heartbeat).
//
//   Local seed:  npx tsx scripts/mars-snapshot.ts
//   Dry run:     npx tsx scripts/mars-snapshot.ts --dry-run   (fetch+parse+print, write NOTHING)
//   CI:          same, with AMS_MARS_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
//
// FRESHNESS IS ROW-LEVEL: report_date = the MAX report_date in the PRICED section, never the
// catalog/publish date (dead barns lie via catalog date — Riverton proved it in recon). We
// keep ONLY the rows on that newest date. SECTION SELECTION: the priced section is the array
// whose rows carry avg_price/avg_weight — NOT the largest array, NOT a narrative section
// (the Direct-report trap). NEVER print or commit AMS_MARS_API_KEY.

// @next/env must load before anything reads process.env (mirrors scripts/lrp-snapshot.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── The three validated anchor barns (hardcoded — we don't depend on MARS metadata for
// barn_name/city/state). slug_id is the MARS report slug and the table's natural key. ──────
interface Barn {
  slug: string
  barn_name: string
  city: string
  state: string // 2-letter
}
const BARNS: Barn[] = [
  { slug: '1777', barn_name: 'Billings Livestock Commission',   city: 'Billings',    state: 'MT' }, // Thu
  { slug: '1774', barn_name: 'Public Auction Yards',            city: 'Billings',    state: 'MT' }, // Wed
  { slug: '1773', barn_name: 'Miles City Livestock Commission', city: 'Miles City',  state: 'MT' }, // Tue
]

const REPORT_URL = (slug: string) =>
  `https://marsapi.ams.usda.gov/services/v1.2/reports/${slug}?allSections=true`
const REQ_TIMEOUT = 60_000 // allSections is multi-MB (24k+ history rows) — give it room

// Basic auth: key as username, empty password. Built once; NEVER logged.
const KEY = process.env.AMS_MARS_API_KEY
if (!KEY) {
  console.error('Missing AMS_MARS_API_KEY — set it in .env.local (local) or as a CI secret.')
  process.exit(1)
}
const AUTH = 'Basic ' + Buffer.from(`${KEY}:`).toString('base64')

const DRY_RUN = process.argv.includes('--dry-run') || process.env.MARS_SNAPSHOT_DRY_RUN === '1'

// ─── Coercion helpers (MARS fields arrive as numbers OR numeric strings OR absent) ──────
type Raw = Record<string, unknown>

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,\s]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}
function str(v: unknown): string | null {
  return v == null || v === '' ? null : String(v)
}
// 'MM/DD/YYYY' (or ISO) → epoch ms; NaN if unparseable (so a bad date is dropped, not maxed).
function dateMs(v: unknown): number {
  if (!v) return NaN
  const t = Date.parse(String(v).replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2'))
  return Number.isNaN(t) ? NaN : t
}
function dateIso(v: unknown): string | null {
  const t = dateMs(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}
function tsIso(v: unknown): string | null {
  if (!v) return null
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// Collect every array-of-objects in the response (for priced-section selection).
function collectArrays(node: unknown, out: Raw[][]): void {
  if (Array.isArray(node)) {
    if (node.length && node[0] && typeof node[0] === 'object' && !Array.isArray(node[0])) {
      out.push(node as Raw[])
    }
    for (const v of node) collectArrays(v, out)
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node as Raw)) collectArrays((node as Raw)[k], out)
  }
}

// One stored priced row (matches the migration-024 jsonb element shape exactly).
interface PriceRow {
  commodity: string | null
  class: string | null
  frame: string | null
  price_unit: string | null // '$/cwt' vs '$/head' — REQUIRED to interpret avg_price (pairs/bred/fancy lots price per head)
  avg_weight: number | null
  avg_weight_min: number | null
  avg_weight_max: number | null
  avg_price: number | null
  avg_price_min: number | null
  avg_price_max: number | null
  head_count: number | null
  receipts: number | null
  receipts_week_ago: number | null
  receipts_year_ago: number | null
  lot_desc: string | null
  weight_break_low: number | null
  weight_break_high: number | null
}
function mapRow(r: Raw): PriceRow {
  return {
    commodity:          str(r.commodity),
    class:              str(r.class),
    frame:              str(r.frame),
    price_unit:         str(r.price_unit),
    avg_weight:         toNum(r.avg_weight),
    avg_weight_min:     toNum(r.avg_weight_min),
    avg_weight_max:     toNum(r.avg_weight_max),
    avg_price:          toNum(r.avg_price),
    avg_price_min:      toNum(r.avg_price_min),
    avg_price_max:      toNum(r.avg_price_max),
    head_count:         toNum(r.head_count),
    receipts:           toNum(r.receipts),
    receipts_week_ago:  toNum(r.receipts_week_ago),
    receipts_year_ago:  toNum(r.receipts_year_ago),
    lot_desc:           str(r.lot_desc),
    weight_break_low:   toNum(r.weight_break_low),
    weight_break_high:  toNum(r.weight_break_high),
  }
}

interface BarnSnapshot {
  report_date: string // newest row-level date, ISO 'YYYY-MM-DD'
  as_of: string | null
  rows: PriceRow[]
  row_count: number
}

async function fetchBarn(barn: Barn): Promise<BarnSnapshot> {
  const res = await fetch(REPORT_URL(barn.slug), {
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json: unknown = await res.json()

  // PRICED section = the array whose rows carry avg_price (NOT largest, NOT narrative).
  const arrays: Raw[][] = []
  collectArrays(json, arrays)
  const priced = arrays
    .filter(a => Object.keys(a[0]).some(k => /avg_price/i.test(k)))
    .sort((a, b) => b.length - a.length)[0]
  if (!priced) throw new Error('no priced section (no rows carry avg_price)')

  // Freshness = MAX row-level report_date in the priced section; keep ONLY that date's rows.
  let newestMs = -Infinity
  for (const r of priced) {
    const ms = dateMs(r.report_date)
    if (!Number.isNaN(ms) && ms > newestMs) newestMs = ms
  }
  if (newestMs === -Infinity) throw new Error('no parseable report_date in priced rows')
  const report_date = new Date(newestMs).toISOString().slice(0, 10)

  const keptRaw = priced.filter(r => dateIso(r.report_date) === report_date)
  const rows = keptRaw.map(mapRow)
  const as_of = tsIso(keptRaw[0]?.published_date)

  return { report_date, as_of, rows, row_count: rows.length }
}

// ─── Service-role client (real-write path only — dry-run never touches Supabase) ────────
async function makeClient() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in mars-snapshot') } }
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })
}

function fmt(n: number | null): string {
  return n == null ? '—' : String(n)
}

async function main() {
  console.log(`\n[mars-snapshot] fetching ${BARNS.length} anchor barns${DRY_RUN ? ' (DRY RUN)' : ''} …`)

  const results = await Promise.all(
    BARNS.map(async barn => {
      try {
        return { barn, snap: await fetchBarn(barn), ok: true as const }
      } catch (err) {
        return { barn, ok: false as const, err: err instanceof Error ? err.message : String(err) }
      }
    }),
  )

  for (const r of results) {
    if (r.ok) {
      const ageDays = Math.round((Date.now() - Date.parse(`${r.snap.report_date}T00:00:00Z`)) / 86_400_000)
      console.log(
        `  ✓ ${r.barn.slug} ${r.barn.barn_name} (${r.barn.city}, ${r.barn.state}) — ` +
        `report_date ${r.snap.report_date} (${ageDays}d old) · ${r.snap.row_count} priced rows`,
      )
    } else {
      console.log(`  ✗ ${r.barn.slug} ${r.barn.barn_name} — FAILED: ${r.err}`)
    }
  }

  const good = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
  if (good.length === 0) {
    console.error('[mars-snapshot] every barn failed — writing nothing.')
    process.exit(1)
  }

  if (DRY_RUN) {
    for (const { barn, snap } of good) {
      // commodity × class distribution — quick sanity that the section + mapping are right.
      const dist = new Map<string, number>()
      for (const row of snap.rows) {
        const k = `${row.commodity ?? '?'} / ${row.class ?? '?'}`
        dist.set(k, (dist.get(k) ?? 0) + 1)
      }
      console.log(`\n[${barn.slug}] ${barn.barn_name} — ${barn.city}, ${barn.state}`)
      console.log(`   report_date ${snap.report_date} · as_of ${snap.as_of ?? '—'} · ${snap.row_count} rows`)
      console.log(`   distribution: ${[...dist.entries()].map(([k, n]) => `${k}×${n}`).join(' · ')}`)
      // Sample a SPREAD across commodities so the mapping is visible on the rows that matter
      // most: feeder steers/heifers carry frame + weight_break (the Zestimate's main path).
      const pick = (p: (r: PriceRow) => boolean) => snap.rows.find(p)
      const sample = [
        pick(r => !!r.commodity?.includes('Feeder') && r.class === 'Steers'),
        pick(r => !!r.commodity?.includes('Feeder') && r.class === 'Heifers'),
        pick(r => !!r.commodity?.includes('Replacement')),
        pick(r => !!r.commodity?.includes('Slaughter')),
      ].filter((r): r is PriceRow => !!r)
      for (const r of (sample.length ? sample : snap.rows.slice(0, 3))) {
        console.log(
          `     • ${r.commodity ?? '?'} | ${r.class ?? '?'} | ${r.frame ?? '—'} | ` +
          `wt ${fmt(r.avg_weight)} (${fmt(r.avg_weight_min)}-${fmt(r.avg_weight_max)}) lb | ` +
          `$${fmt(r.avg_price)} (${fmt(r.avg_price_min)}-${fmt(r.avg_price_max)}) ${r.price_unit ?? '?'} | ` +
          `${fmt(r.head_count)} hd | brk ${fmt(r.weight_break_low)}-${fmt(r.weight_break_high)} | ` +
          `${r.lot_desc ?? '—'} | rcpts ${fmt(r.receipts)} (wk ${fmt(r.receipts_week_ago)}, yr ${fmt(r.receipts_year_ago)})`,
        )
      }
    }
    console.log('\n[mars-snapshot] DRY RUN — nothing written.\n')
    return
  }

  // Real write — upsert one row per successful barn. ingested_at set EXPLICITLY (not the
  // column default, which fires only on INSERT) so MAX(ingested_at) advances on every run's
  // UPDATE and tracks pipeline health (mirrors news_items). slug_id is the natural key.
  const db = await makeClient()
  const now = new Date().toISOString()
  const payload = good.map(({ barn, snap }) => ({
    slug_id:     barn.slug,
    barn_name:   barn.barn_name,
    city:        barn.city,
    state:       barn.state,
    report_date: snap.report_date,
    as_of:       snap.as_of,
    source:      'USDA MARS',
    rows:        snap.rows,
    row_count:   snap.row_count,
    ingested_at: now,
  }))

  const { data, error } = await db
    .from('mars_price_snapshots')
    .upsert(payload, { onConflict: 'slug_id' })
    .select('slug_id, barn_name, report_date, row_count, ingested_at')
  if (error) {
    console.error('[mars-snapshot] upsert failed:', error.message)
    process.exit(1)
  }
  // Log the PERSISTED rows (the table's own response) as the write receipt — confirms what
  // landed, not just what we sent.
  const landed = (data ?? []) as Array<{ slug_id: string; barn_name: string; report_date: string; row_count: number }>
  console.log(`\n[mars-snapshot] upserted ${landed.length || payload.length} barn snapshot(s) ✓`)
  for (const r of landed) {
    console.log(`  ${r.slug_id} ${r.barn_name} — report_date ${r.report_date} · ${r.row_count} rows`)
  }
  console.log('')
}

main().catch(err => {
  console.error('[mars-snapshot] threw:', err instanceof Error ? err.message : err)
  process.exit(1)
})

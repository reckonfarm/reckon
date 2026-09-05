import 'server-only'
import { createServiceClient } from '@/lib/supabase'
import type { MarsPriceRow } from '@/lib/barn-geo'
import { BARN_GEO } from '@/lib/barn-geo'
import { THIN_HEAD_THRESHOLD } from '@/lib/market-scope'

// ─── Market series (Block 2.5, Part B) — what the tables actually hold ────────
//
// Read-only derivations over the snapshot tables for the charts. Every point
// is an OBSERVATION the source reported: an auction sale date, a weekly
// national report, a settle, a quarterly inventory point. Nothing here
// interpolates, smooths, or fills; the chart draws points and, at most, a
// visibly distinct carried-forward step. Each point carries its evidence
// (head reported, class, weight range, report id) so a tap can show it.
//
// mars_price_history is read at its CURRENT revision (superseded_by IS NULL
// once migration 047 lands; before that every row is current).

export interface AuctionPoint {
  date: string          // sale date, ISO
  price: number         // head-weighted $/cwt inside the band
  low: number | null
  high: number | null
  head: number          // head reported behind the point
  thin: boolean         // head < THIN_HEAD_THRESHOLD
  reportId: string      // MARS slug
  barn: string
  town: string
  cls: string           // 'Steers' | 'Heifers'
  band: string          // '500' → 500–599 lb
  revision: number | null
}

export interface AuctionSeries {
  key: string           // `${slug}:${cls}:${band}`
  slug: string
  barn: string
  town: string
  cls: string
  band: string
  points: AuctionPoint[]   // oldest first
}

const BANDS = ['400', '500', '600', '700'] as const
export type Band = (typeof BANDS)[number]
export const AUCTION_BANDS: readonly Band[] = BANDS

function bandOf(w: number | null): Band | null {
  if (w == null) return null
  const h = Math.floor(w / 100) * 100
  return h >= 400 && h <= 700 ? (String(h) as Band) : null
}

interface HistRow { slug_id: string; barn_name: string; report_date: string; rows: MarsPriceRow[]; revision?: number | null; superseded_by?: number | null }

/** Weekly auction observations per barn × class × band, current revision only. */
export async function getAuctionSeries(slugs: string[], opts: { cls?: string[]; since?: string } = {}): Promise<AuctionSeries[]> {
  if (slugs.length === 0) return []
  try {
    const db = createServiceClient()
    let q = db.from('mars_price_history')
      .select('slug_id, barn_name, report_date, rows, revision, superseded_by')
      .in('slug_id', slugs)
      .order('report_date', { ascending: true })
      .limit(2000)
    if (opts.since) q = q.gte('report_date', opts.since)
    const first = await q
    let data: unknown[] | null = first.data as unknown[] | null
    let error = first.error
    if (error && /revision|superseded_by/.test(error.message)) {
      const legacy = await db.from('mars_price_history').select('slug_id, barn_name, report_date, rows').in('slug_id', slugs).order('report_date', { ascending: true }).limit(2000)
      data = legacy.data as unknown[] | null; error = legacy.error
    }
    if (error || !data) return []
    const classes = opts.cls ?? ['Steers', 'Heifers']
    const series = new Map<string, AuctionSeries>()
    for (const r of (data as HistRow[])) {
      if (r.superseded_by != null) continue
      const town = BARN_GEO[r.slug_id]?.town.replace(/,\s*[A-Z]{2}$/, '') ?? r.barn_name
      // head-weighted $/cwt per class × band for this sale date
      const acc = new Map<string, { wsum: number; head: number; lo: number; hi: number }>()
      for (const row of r.rows ?? []) {
        if (row.commodity !== 'Feeder Cattle' || !classes.includes(row.class ?? '')) continue
        if (row.price_unit !== 'Per Cwt' || row.avg_price == null) continue
        if (!/medium and large/i.test(row.frame ?? '')) continue
        const band = bandOf(row.avg_weight)
        const head = row.head_count ?? 0
        if (!band || head <= 0) continue
        const k = `${row.class}:${band}`
        const a = acc.get(k) ?? { wsum: 0, head: 0, lo: Infinity, hi: -Infinity }
        a.wsum += row.avg_price * head; a.head += head
        a.lo = Math.min(a.lo, row.avg_price_min ?? row.avg_price); a.hi = Math.max(a.hi, row.avg_price_max ?? row.avg_price)
        acc.set(k, a)
      }
      for (const [k, a] of acc) {
        const [cls, band] = k.split(':')
        const key = `${r.slug_id}:${cls}:${band}`
        const s = series.get(key) ?? { key, slug: r.slug_id, barn: r.barn_name, town, cls, band, points: [] }
        s.points.push({
          date: r.report_date, price: Math.round((a.wsum / a.head) * 100) / 100,
          low: a.lo === Infinity ? null : a.lo, high: a.hi === -Infinity ? null : a.hi,
          head: a.head, thin: a.head < THIN_HEAD_THRESHOLD, reportId: r.slug_id, barn: r.barn_name, town,
          cls, band, revision: r.revision ?? null,
        })
        series.set(key, s)
      }
    }
    return [...series.values()].map(s => ({ ...s, points: s.points.sort((a, b) => a.date.localeCompare(b.date)) }))
  } catch {
    return []
  }
}

export interface NationalPoint { date: string; value: number; low: number | null; high: number | null; head: number | null; metric: string; reportId: string }
/** Weekly national observations (national_beef_snapshots), oldest first. */
export async function getNationalSeries(metric: string): Promise<NationalPoint[]> {
  try {
    const db = createServiceClient()
    const { data, error } = await db.from('national_beef_snapshots')
      .select('report_slug, metric, week_ending, value, price_low, price_high, head_count')
      .eq('metric', metric).order('week_ending', { ascending: true }).limit(1000)
    if (error || !data) return []
    return (data as { report_slug: string; metric: string; week_ending: string; value: number; price_low: number | null; price_high: number | null; head_count: number | null }[])
      .filter(r => typeof r.value === 'number')
      .map(r => ({ date: r.week_ending, value: Number(r.value), low: r.price_low == null ? null : Number(r.price_low), high: r.price_high == null ? null : Number(r.price_high), head: r.head_count == null ? null : Number(r.head_count), metric: r.metric, reportId: r.report_slug }))
  } catch { return [] }
}

export interface CornPoint { date: string; settle: number }   // ¢/bu
export async function getCornSeries(): Promise<CornPoint[]> {
  try {
    const db = createServiceClient()
    const { data, error } = await db.from('corn_price_snapshots').select('settle_date, settle_price').order('settle_date', { ascending: true }).limit(2000)
    if (error || !data) return []
    return (data as { settle_date: string; settle_price: number }[]).map(r => ({ date: r.settle_date, settle: Number(r.settle_price) }))
  } catch { return [] }
}

export interface CyclePoint { date: string; heifersOnFeed: number; priorYear: number | null; yoyPct: number | null }
export async function getCycleSeries(): Promise<CyclePoint[]> {
  try {
    const db = createServiceClient()
    const { data, error } = await db.from('cattle_cycle_snapshots').select('report_point, heifers_on_feed, prior_year_heifers, yoy_pct').order('report_point', { ascending: true }).limit(200)
    if (error || !data) return []
    return (data as { report_point: string; heifers_on_feed: number; prior_year_heifers: number | null; yoy_pct: number | null }[])
      .map(r => ({ date: r.report_point, heifersOnFeed: Number(r.heifers_on_feed), priorYear: r.prior_year_heifers == null ? null : Number(r.prior_year_heifers), yoyPct: r.yoy_pct == null ? null : Number(r.yoy_pct) }))
  } catch { return [] }
}

export interface MarketEvent { id: number; date: string; title: string; description: string; category: string; sourceName: string; sourceUrl: string }
export async function getMarketEvents(from?: string): Promise<MarketEvent[]> {
  try {
    const db = createServiceClient()
    let q = db.from('market_events').select('id, event_date, title, description, category, source_name, source_url').order('event_date', { ascending: true }).limit(500)
    if (from) q = q.gte('event_date', from)
    const { data, error } = await q
    if (error || !data) return []
    return (data as { id: number; event_date: string; title: string; description: string; category: string; source_name: string; source_url: string }[])
      .map(r => ({ id: r.id, date: r.event_date, title: r.title, description: r.description, category: r.category, sourceName: r.source_name, sourceUrl: r.source_url }))
  } catch { return [] }
}

// ─── Week-of-year framing for "this year against the last N" and seasonality ──
export function isoWeek(dateIso: string): number {
  const d = new Date(`${dateIso}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
}

export interface YearFrame {
  years: number[]                 // years present in the spine, ascending
  currentYear: number
  priorYear: number | null
  bandYears: number[]             // years the band is built from (excludes current)
  byWeek: Record<number, { year: number; price: number; head: number; date: string }[]>
}
export function frameByYear(points: AuctionPoint[]): YearFrame {
  const byWeek: YearFrame['byWeek'] = {}
  const years = new Set<number>()
  for (const p of points) {
    const y = Number(p.date.slice(0, 4)); years.add(y)
    const w = isoWeek(p.date)
    ;(byWeek[w] ??= []).push({ year: y, price: p.price, head: p.head, date: p.date })
  }
  const ys = [...years].sort((a, b) => a - b)
  const currentYear = ys[ys.length - 1] ?? new Date().getUTCFullYear()
  const priorYear = ys.length > 1 ? ys[ys.length - 2] : null
  return { years: ys, currentYear, priorYear, bandYears: ys.filter(y => y !== currentYear).slice(-5), byWeek }
}

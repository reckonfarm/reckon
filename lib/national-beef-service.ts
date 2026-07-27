import 'server-only'

import { createServiceClient } from './supabase'

// ─── National beef benchmark service (read path) ─────────────────────────────────
//
// Reads public.national_beef_snapshots (migration 032, written by
// scripts/national-beef-snapshot.ts) for the Markets view's national card. PUBLIC
// reference data (RLS-on-with-no-policies) → SERVICE-ROLE client. Pure Supabase read:
// no request-time external fetch, so the render path has nothing to time out.
//
// HONEST RESULT (mirrors lib/lrp-service.ts — discriminated, never fabricate):
//   • { status: 'ok', ... }            → at least one metric present; each of the three
//                                        metrics is independently nullable, so a dead
//                                        source degrades ONE line to 'warming up',
//                                        never the whole card.
//   • { status: 'none' }               → table empty (pre-seed) — 'warming up'.
//   • { status: 'data_unavailable' }   → read error — never a fabricated price.
// stale is per-metric: weekly reports, so > STALE_DAYS without a new week means the
// value renders with its real week-ending date, labeled, never passed off as current.

export interface NationalMetricRead {
  value: number          // $/cwt
  priorValue: number | null
  changePct: number | null
  weekEnding: string     // ISO date
  priceLow: number | null
  priceHigh: number | null
  headCount: number | null
  stale: boolean
}

export type NationalBeefResult =
  | { status: 'ok'; fedSteer: NationalMetricRead | null; feeder500: NationalMetricRead | null; feeder700: NationalMetricRead | null }
  | { status: 'none' }
  | { status: 'data_unavailable' }

const STALE_DAYS = 10 // weekly cadence + a publish-lag cushion

interface SnapshotRow {
  metric: string
  week_ending: string
  value: number | string
  price_low: number | string | null
  price_high: number | string | null
  head_count: number | null
  prior_value: number | string | null
  change_pct: number | string | null
}

function num(v: number | string | null): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function toRead(r: SnapshotRow, todayMs: number): NationalMetricRead | null {
  const value = num(r.value)
  if (value == null) return null
  const ageDays = (todayMs - Date.parse(`${r.week_ending}T00:00:00Z`)) / 86_400_000
  return {
    value,
    priorValue: num(r.prior_value),
    changePct: num(r.change_pct),
    weekEnding: r.week_ending,
    priceLow: num(r.price_low),
    priceHigh: num(r.price_high),
    headCount: r.head_count,
    stale: ageDays > STALE_DAYS,
  }
}

export async function getNationalBeef(): Promise<NationalBeefResult> {
  try {
    const db = createServiceClient()
    // Newest row per metric: newest-first scan, first hit per metric wins. The table
    // holds ~1 row/metric/week, so a small window covers it comfortably.
    const { data, error } = await db
      .from('national_beef_snapshots')
      .select('metric, week_ending, value, price_low, price_high, head_count, prior_value, change_pct')
      .order('week_ending', { ascending: false })
      .limit(60)

    if (error) {
      console.error('[national-beef] read failed:', error.message)
      return { status: 'data_unavailable' }
    }
    const rows = (data ?? []) as SnapshotRow[]
    if (rows.length === 0) return { status: 'none' }

    const newest = new Map<string, SnapshotRow>()
    for (const r of rows) if (!newest.has(r.metric)) newest.set(r.metric, r)

    const now = Date.now()
    return {
      status: 'ok',
      fedSteer:  newest.has('fed_steer_live')   ? toRead(newest.get('fed_steer_live')!, now)   : null,
      feeder500: newest.has('feeder_steer_500') ? toRead(newest.get('feeder_steer_500')!, now) : null,
      feeder700: newest.has('feeder_steer_700') ? toRead(newest.get('feeder_steer_700')!, now) : null,
    }
  } catch (err) {
    console.error('[national-beef] read threw:', err)
    return { status: 'data_unavailable' }
  }
}

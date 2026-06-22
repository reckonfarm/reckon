import 'server-only'

import { createServiceClient } from './supabase'

// ─── Corn price service (read path) ────────────────────────────────────────────────
//
// Reads public.corn_price_snapshots (migration 027) for the dashboard's Market Read —
// the Price leg (§4 Leg 3). PUBLIC reference data (RLS-on-with-no-policies), so it reads
// with the SERVICE-ROLE client — NOT the SSR/anon client. (Same posture as lib/lrp-service.)
//
// The CBOT ZC=F settle is fetched + parsed OFF the request path by scripts/corn-snapshot.ts
// (a GitHub Actions cron), which upserts one row per settle date. This module just READS the
// most recent front-month row — a fast Supabase SELECT.
//
// HONEST RESULT (mirrors getLatestLrp — discriminated, never fabricate):
//   • fresh settle      → { status: 'ok', … } with stale=false + real settleDate + direction.
//   • stale settle      → { status: 'ok', … } with stale=TRUE (a daily settle was missed);
//                         STILL shown, but labeled with its real settleDate, never "current".
//   • no row at all     → { status: 'none' } (nothing seeded yet — chip stays "warming up").
//   • query error / bad payload → { status: 'data_unavailable' } (honest, never a NaN/$0).

// Front-month continuous CBOT corn — the one symbol the dashboard Price chip reads. (The
// table can also hold a new-crop December row later; the chip pins to front month.)
const SYMBOL = 'ZC=F'

// A settle older than this (by settle_date) means a daily business-day settle was missed —
// show it, but flagged stale. Corn settles each business day, so ~4 days tolerates a normal
// weekend/holiday gap before we call it stale.
const STALE_DAYS = 4

export type CornDirection = 'up' | 'down' | 'flat'

export type CornResult =
  | {
      status: 'ok'
      settlePrice: number          // ¢/bushel
      priorSettle: number | null   // prior session settle (null until one exists)
      changePct: number | null     // vs prior settle; null when no prior
      direction: CornDirection
      settleDate: string           // ISO 'YYYY-MM-DD'
      stale: boolean
    }
  | { status: 'none' }
  | { status: 'data_unavailable' }

interface SnapshotRow {
  settle_date:  string
  settle_price: unknown
  prior_settle: unknown
}

// Copied from lib/lrp-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function getLatestCornSettle(): Promise<CornResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('corn_price_snapshots')
      .select('settle_date, settle_price, prior_settle')
      .eq('symbol', SYMBOL)
      .order('settle_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[corn] snapshot read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const row = data as SnapshotRow | null
    if (!row) return { status: 'none' }

    // A non-finite settle is a bad payload, not a fabricated number.
    const settlePrice = finiteNum(row.settle_price)
    if (settlePrice === null || !row.settle_date) {
      console.error('[corn] snapshot settle unparseable — treating as unavailable')
      return { status: 'data_unavailable' }
    }

    const priorSettle = finiteNum(row.prior_settle)
    const changePct =
      priorSettle !== null && priorSettle !== 0
        ? ((settlePrice - priorSettle) / priorSettle) * 100
        : null
    const direction: CornDirection =
      priorSettle === null || settlePrice === priorSettle
        ? 'flat'
        : settlePrice > priorSettle
          ? 'up'
          : 'down'

    // Staleness from the real settle_date — never fabricate currency.
    const ageDays = (Date.now() - Date.parse(`${row.settle_date}T00:00:00Z`)) / 86_400_000
    const stale = !Number.isFinite(ageDays) || ageDays > STALE_DAYS

    return {
      status: 'ok',
      settlePrice,
      priorSettle,
      changePct,
      direction,
      settleDate: row.settle_date,
      stale,
    }
  } catch (err) {
    console.error('[corn] read threw:', err)
    return { status: 'data_unavailable' }
  }
}

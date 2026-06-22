import 'server-only'

import { createServiceClient } from './supabase'

// ─── Feeding-region moisture service (read path) ────────────────────────────────────
//
// Reads public.feeding_region_moisture (migration 028) for the dashboard's Market Read —
// the Moisture leg (§4 Leg 1). PUBLIC reference data (RLS-on-with-no-policies), so it reads
// with the SERVICE-ROLE client. (Same posture as lib/corn-service / lib/lrp-service.)
//
// The USDM footprint aggregate is computed OFF the request path by scripts/moisture-snapshot.ts
// (a weekly GitHub Actions cron), which area-weights D1+ across the §4 16-state footprint and
// upserts one row per USDM map week. This module just READS the most recent row.
//
// SEPARATE from the per-county LFP/home-county USDM reads (lib/lfp-eligibility.ts): same
// upstream host, different endpoint/scope/meaning (feeder demand across the region, NOT money
// owed for one county). Do not cross-wire.
//
// DIRECTION SEMANTICS (the trap): drought_pct FALLING means the feeding country got WETTER —
// which is GOOD for calf demand (feed getting made). So a falling number → 'wetter', a rising
// number → 'drier'. This is the INVERSE of the raw-number direction; the chip colors 'wetter'
// as the good/up token and 'drier' as the bad/down token.
//
// HONEST RESULT (mirrors getLatestCornSettle — discriminated, never fabricate):
//   • fresh row   → { status:'ok', … } with stale=false + real mapDate + direction.
//   • stale row   → { status:'ok', … } with stale=TRUE (a weekly update was missed); STILL
//                   shown, labeled with its real mapDate, never "current".
//   • no row      → { status:'none' } (nothing seeded yet — chip stays "warming up").
//   • query error / bad payload → { status:'data_unavailable' } (honest, never a false 0%).

// USDM updates weekly (Thursdays), so a row older than ~14 days means an update was missed.
const STALE_DAYS = 14

export type MoistureDirection = 'wetter' | 'drier' | 'flat'

export type MoistureResult =
  | {
      status: 'ok'
      droughtPct: number          // area-weighted % of the footprint in D1+
      priorPct: number | null     // same metric ~4 weeks prior (null until one exists)
      changePts: number | null    // droughtPct - priorPct (percentage points); null when no prior
      direction: MoistureDirection
      mapDate: string             // ISO 'YYYY-MM-DD' (USDM map week)
      stale: boolean
    }
  | { status: 'none' }
  | { status: 'data_unavailable' }

interface SnapshotRow {
  map_date:          string
  drought_pct:       unknown
  prior_drought_pct: unknown
}

// Copied from lib/corn-service.ts / lib/lrp-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function getFeedingRegionMoisture(): Promise<MoistureResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('feeding_region_moisture')
      .select('map_date, drought_pct, prior_drought_pct')
      .order('map_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[moisture] snapshot read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const row = data as SnapshotRow | null
    if (!row) return { status: 'none' }

    // A non-finite drought % is a bad payload, not a fabricated number.
    const droughtPct = finiteNum(row.drought_pct)
    if (droughtPct === null || !row.map_date) {
      console.error('[moisture] snapshot drought_pct unparseable — treating as unavailable')
      return { status: 'data_unavailable' }
    }

    const priorPct = finiteNum(row.prior_drought_pct)
    const changePts = priorPct !== null ? droughtPct - priorPct : null
    // Falling drought = wetter (good); rising = drier (bad). Inverse of the raw number.
    const direction: MoistureDirection =
      priorPct === null || droughtPct === priorPct
        ? 'flat'
        : droughtPct < priorPct
          ? 'wetter'
          : 'drier'

    const ageDays = (Date.now() - Date.parse(`${row.map_date}T00:00:00Z`)) / 86_400_000
    const stale = !Number.isFinite(ageDays) || ageDays > STALE_DAYS

    return { status: 'ok', droughtPct, priorPct, changePts, direction, mapDate: row.map_date, stale }
  } catch (err) {
    console.error('[moisture] read threw:', err)
    return { status: 'data_unavailable' }
  }
}

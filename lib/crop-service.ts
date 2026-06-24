import 'server-only'

import { createServiceClient } from './supabase'

// ─── Crop condition service (read path) ─────────────────────────────────────────────
//
// Reads public.crop_condition_snapshots (migration 029) for the dashboard's Market Read —
// the Crop leg (§4 Leg 2). PUBLIC reference data (RLS-on-with-no-policies), so it reads with
// the SERVICE-ROLE client. (Same posture as lib/corn-service / lib/moisture-service.)
//
// US corn good+excellent % is captured weekly OFF the request path by scripts/crop-snapshot.ts
// (a weekly NASS Quick Stats cron). This module just READS the most recent row.
//
// DIRECTION SEMANTICS: a RISING good+excellent % means a BETTER crop → more/cheaper feed →
// supportive for calf demand. So rising = 'better' (the good direction). Unlike Moisture
// (where the raw number falling is good), here the raw number rising is good, so the chip's
// arrow AND color agree (▲ + green = better). Green = supportive-for-calves across all chips.
//
// SEASONALITY (the leg's distinctive state): NASS reports CONDITION only ~Apr–Nov. Out of
// season the latest week_ending freezes at last November — we must NOT show that months-old
// number as current. getLatestCropCondition returns a dedicated 'off_season' state instead.
//
// HONEST RESULT (mirrors getLatestCornSettle / getFeedingRegionMoisture — never fabricate):
//   • fresh week     → { status:'ok', … } stale=false + real weekEnding + direction.
//   • in-season miss → { status:'ok', … } stale=TRUE (labeled "as of <week>", never "current").
//   • off season     → { status:'off_season' } ("resumes in spring" — never a frozen number).
//   • no row         → { status:'none' } (nothing seeded — chip "warming up").
//   • query error / bad payload → { status:'data_unavailable' }.

// In-season a report posts ~weekly, so >10 days = a missed week (stale). >21 days with no new
// report = reporting has stopped (off-season). The Apr–Nov window is the secondary signal:
// modestly-old data while outside that window is already off-season (handles a not-yet-started
// April where last November's number is months old).
const STALE_DAYS = 10
const REPORTING_GAP_DAYS = 21

export type CropDirection = 'better' | 'worse' | 'flat'

export type CropResult =
  | {
      status: 'ok'
      gePct: number               // good + excellent %
      priorPct: number | null     // ~4 weeks prior (null until an in-season prior exists)
      changePts: number | null    // gePct - priorPct; null when no prior
      direction: CropDirection
      weekEnding: string          // ISO 'YYYY-MM-DD'
      stale: boolean
    }
  | { status: 'off_season' }
  | { status: 'none' }
  | { status: 'data_unavailable' }

interface SnapshotRow {
  week_ending:        string
  good_excellent_pct: unknown
  prior_ge_pct:       unknown
}

// Copied from lib/corn-service.ts / lib/moisture-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function getLatestCropCondition(): Promise<CropResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('crop_condition_snapshots')
      .select('week_ending, good_excellent_pct, prior_ge_pct')
      .eq('commodity', 'CORN')
      .eq('geography', 'US')
      .order('week_ending', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[crop] snapshot read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const row = data as SnapshotRow | null
    if (!row) return { status: 'none' }

    const gePct = finiteNum(row.good_excellent_pct)
    if (gePct === null || !row.week_ending) {
      console.error('[crop] snapshot good_excellent_pct unparseable — treating as unavailable')
      return { status: 'data_unavailable' }
    }

    // Age + season: decide off_season vs stale vs fresh.
    const ageDays = (Date.now() - Date.parse(`${row.week_ending}T00:00:00Z`)) / 86_400_000
    if (!Number.isFinite(ageDays)) return { status: 'data_unavailable' }
    const month = new Date().getUTCMonth() + 1                 // 1–12
    const inReportingWindow = month >= 4 && month <= 11
    // Reporting has clearly stopped: a long gap (any month), or modestly-old data outside
    // the Apr–Nov window. Either way, don't pass a frozen number off as current.
    if (ageDays > REPORTING_GAP_DAYS || (!inReportingWindow && ageDays > STALE_DAYS)) {
      return { status: 'off_season' }
    }

    const priorPct = finiteNum(row.prior_ge_pct)
    const changePts = priorPct !== null ? gePct - priorPct : null
    // Rising G/E = better crop (good); falling = worse. Raw number and meaning agree here.
    const direction: CropDirection =
      priorPct === null || gePct === priorPct
        ? 'flat'
        : gePct > priorPct
          ? 'better'
          : 'worse'

    const stale = ageDays > STALE_DAYS                          // in-season missed week

    return { status: 'ok', gePct, priorPct, changePts, direction, weekEnding: row.week_ending, stale }
  } catch (err) {
    console.error('[crop] read threw:', err)
    return { status: 'data_unavailable' }
  }
}

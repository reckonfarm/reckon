import 'server-only'

import { createServiceClient } from './supabase'

// ─── Cattle cycle service (read path) ───────────────────────────────────────────────
//
// Reads public.cattle_cycle_snapshots (migration 030) for the dashboard's Market Read — the
// cattle-cycle "master switch" evidence chip (§2). PUBLIC reference data (RLS-on-with-no-
// policies), so it reads with the SERVICE-ROLE client. (Same posture as the other three legs.)
//
// US heifers-on-feed is captured QUARTERLY off the request path by scripts/cattle-cycle-
// snapshot.ts (a NASS Quick Stats cron). This module just READS the most recent row.
//
// DIRECTION SEMANTICS: FEWER heifers on feed than a year ago (yoyPct < 0) means heifers are
// being HELD BACK / the herd is rebuilding → tighter future supply → SUPPORTIVE for calf
// prices. MORE (yoyPct > 0) means they're STILL going to feed, not retaining yet → ample
// supply / pressure. Per dad's read, ANY negative reads as holding_back — no dead-band that
// would soften −1.4% into "steady"; only a true ~0 (|yoyPct| < EPS) is 'steady'. The chip
// colors holding_back as the good/supportive token (green), like falling drought / rising crop.
//
// CADENCE: the heifer split is QUARTERLY (Jan/Apr/Jul/Oct), released ~6–8 weeks later — so a
// 100-day-old number is NORMAL, not stale. Stale only past ~one quarter + the release lag.
//
// HONEST RESULT (mirrors the other legs — never fabricate):
//   • fresh quarter → { status:'ok', … } stale=false + real reportPoint + direction.
//   • old quarter   → { status:'ok', … } stale=TRUE (labeled "as of <quarter>", never current).
//   • no row        → { status:'none' } (nothing seeded — chip "warming up").
//   • query error / bad payload → { status:'data_unavailable' }.

// Quarterly data + ~6–8 week release lag: ~one quarter (90d) + lag. Past this, a quarter was
// genuinely missed. (Far wider than the weekly legs' ~14-day window — by design.)
const STALE_DAYS = 135
// Tight epsilon: only a near-exact YoY of 0 is 'steady'. −1.4% is holding_back, not steady.
const STEADY_EPS = 0.1

export type CycleDirection = 'holding_back' | 'still_feeding' | 'steady'

export type CycleResult =
  | {
      status: 'ok'
      heifersOnFeed: number        // head on feed at the latest quarter
      priorYear: number | null     // same quarter, prior year (null until one exists)
      yoyPct: number | null        // YoY % change; null when no prior
      direction: CycleDirection
      reportPoint: string          // ISO 'YYYY-MM-DD' (quarter point)
      stale: boolean
    }
  | { status: 'none' }
  | { status: 'data_unavailable' }

interface SnapshotRow {
  report_point:    string
  heifers_on_feed: unknown
  prior_year_heifers: unknown
  yoy_pct:         unknown
}

// Copied from lib/crop-service.ts / lib/corn-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function getCattleCycle(): Promise<CycleResult> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('cattle_cycle_snapshots')
      .select('report_point, heifers_on_feed, prior_year_heifers, yoy_pct')
      .order('report_point', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[cycle] snapshot read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    const row = data as SnapshotRow | null
    if (!row) return { status: 'none' }

    const heifersOnFeed = finiteNum(row.heifers_on_feed)
    if (heifersOnFeed === null || !row.report_point) {
      console.error('[cycle] snapshot heifers_on_feed unparseable — treating as unavailable')
      return { status: 'data_unavailable' }
    }

    const priorYear = finiteNum(row.prior_year_heifers)
    const yoyPct = finiteNum(row.yoy_pct)
    // Fewer heifers YoY = holding back (supportive); more = still feeding; only ~0 = steady.
    const direction: CycleDirection =
      yoyPct === null || Math.abs(yoyPct) < STEADY_EPS
        ? 'steady'
        : yoyPct < 0
          ? 'holding_back'
          : 'still_feeding'

    const ageDays = (Date.now() - Date.parse(`${row.report_point}T00:00:00Z`)) / 86_400_000
    const stale = !Number.isFinite(ageDays) || ageDays > STALE_DAYS

    return { status: 'ok', heifersOnFeed, priorYear, yoyPct, direction, reportPoint: row.report_point, stale }
  } catch (err) {
    console.error('[cycle] read threw:', err)
    return { status: 'data_unavailable' }
  }
}

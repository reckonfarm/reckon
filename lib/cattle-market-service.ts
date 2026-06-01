import 'server-only'

import { createServiceClient } from './supabase'
import {
  REPORT_SLUG,
  mockMarket,
  type CattleMarket,
} from './cattle-report-1778'

// ─── Cattle market service (read path) ───────────────────────────────────────────
//
// www.ams.usda.gov 403-blocks Vercel's datacenter egress (proven via /api/cattle-debug:
// identical request returns 200 residential, 403 from Vercel). So we no longer fetch
// the report from the request path. Instead a GitHub Action (non-blocked IP) runs the
// parser in lib/cattle-report-1778.ts on a weekly schedule and UPSERTS the parsed
// snapshot into cattle_market_snapshots. This module just READS the most recent
// snapshot — a fast Supabase SELECT that works fine from Vercel.
//
// FRESHNESS (the precip lesson — never show stale as fresh, never fabricate a date):
//   • fresh snapshot       → status 'ok', stale false, real as-of date.
//   • stale snapshot       → status 'ok', stale TRUE (a run was missed); still shown,
//                            but the UI labels it with its real as-of date, never "current".
//   • no snapshot at all   → status 'data_unavailable' (honest empty state).
//
// Types live in cattle-report-1778 and are re-exported here so existing UI imports
// (`@/lib/cattle-market-service`) need zero changes.

export type {
  FeederClass,
  FeederBySex,
  SlaughterGroup,
  CattleReceipts,
  FeederComposition,
  CattleMarket,
} from './cattle-report-1778'

// A snapshot older than this (by published as-of date) means a weekly run was
// missed — show it, but clearly flagged stale. The report is weekly (Tue), so ~10
// days tolerates the normal cadence + a little slack before we call it stale.
const STALE_DAYS = 10

interface SnapshotRow {
  report_week_start: string
  as_of_date: string | null
  snapshot: CattleMarket
}

function dataUnavailable(): CattleMarket {
  return {
    status: 'data_unavailable',
    mode: 'live',
    stale: false,
    reportId: '1778',
    source: 'USDA AMS Market News — Montana Weekly Livestock Auction Summary (Report 1778)',
    asOf: null, asOfLabel: null, reportWindowLabel: null, reportWeekStart: null, reportWeekEnd: null,
    receipts: { current: null, lastReported: null, lastYear: null },
    feeder: { steers: [], heifers: [] },
    cullCows: null, slaughterBulls: null,
    feederComposition: { steersPct: null, heifersPct: null, bullsPct: null },
    supplyOver600Pct: null, trendText: null,
  }
}

export async function getCattleMarket(): Promise<CattleMarket> {
  if (process.env.CATTLE_MARKET_MOCK === '1') return mockMarket()

  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('cattle_market_snapshots')
      .select('report_week_start, as_of_date, snapshot')
      .eq('report_slug', REPORT_SLUG)
      .order('report_week_start', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[cattle-market] snapshot read failed:', error.message)
      return dataUnavailable()
    }
    const row = data as SnapshotRow | null
    if (!row || !row.snapshot) return dataUnavailable()

    // Determine staleness from the report's real as-of date — never fabricate one.
    const asOf = row.as_of_date ?? row.snapshot.asOf
    let stale = false
    if (asOf) {
      const ageDays = (Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000
      stale = ageDays > STALE_DAYS
    } else {
      // No date we can trust → treat as stale rather than imply currency.
      stale = true
    }

    // Return the stored snapshot verbatim (same shape the UI already renders),
    // overlaying the freshly-computed stale flag and a guaranteed live mode.
    return { ...row.snapshot, mode: 'live', stale }
  } catch (err) {
    console.error('[cattle-market] read threw:', err)
    return dataUnavailable()
  }
}

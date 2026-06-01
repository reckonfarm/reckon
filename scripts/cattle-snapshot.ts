// ─── Cattle snapshot writer ──────────────────────────────────────────────────────
//
// Runs OFF Vercel (GitHub Actions, or locally for seeding) where www.ams.usda.gov
// is NOT 403-blocked. Fetches + parses the weekly USDA AMS reports with the SAME
// parsers the app uses, then UPSERTS each as a snapshot into Supabase. Idempotent
// on (report_slug, report_week_start). Sources:
//   • Montana Livestock Auction Summary (1778)           → slug 'ams_1778'
//   • National Feeder & Stocker Cattle Summary (lswnfss) → slug 'national-feeder-stocker'
//
//   Local seed:  npx tsx scripts/cattle-snapshot.ts
//   CI:          same, with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchAndParseReport, REPORT_SLUG, REPORT_URL, type CattleMarket } from '../lib/cattle-report-1778'
import { fetchAndParseNational, NATIONAL_SLUG, NATIONAL_URL } from '../lib/cattle-report-national'

async function upsertSnapshot(db: SupabaseClient, slug: string, url: string, market: CattleMarket): Promise<boolean> {
  if (market.status !== 'ok' || !market.reportWeekStart) {
    console.error(`[cattle-snapshot] ${slug}: no usable snapshot — NOT writing.`, {
      status: market.status, asOf: market.asOf, weekStart: market.reportWeekStart,
    })
    return false
  }
  console.log(`[cattle-snapshot] ${slug} parsed:`, {
    asOf: market.asOf, window: market.reportWindowLabel,
    steerClasses: market.feeder.steers.length, heiferClasses: market.feeder.heifers.length,
    cullCowAvg: market.cullCows?.avgCwt ?? null, receipts: market.receipts.current,
  })
  const { error } = await db.from('cattle_market_snapshots').upsert(
    {
      report_slug: slug,
      report_week_start: market.reportWeekStart,
      report_week_end: market.reportWeekEnd,
      as_of_date: market.asOf,
      fetched_at: new Date().toISOString(),
      source_url: url,
      snapshot: market,
    },
    { onConflict: 'report_slug,report_week_start' },
  )
  if (error) { console.error(`[cattle-snapshot] ${slug} upsert failed:`, error.message); return false }
  console.log(`[cattle-snapshot] ${slug} upserted week ${market.reportWeekStart} ✓`)
  return true
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  // supabase-js createClient eagerly resolves a WebSocket constructor for realtime
  // and throws on Node ≤20. We only do REST reads/writes (no channels), so passing
  // a never-instantiated transport short-circuits that. (No 'ws' dependency.)
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in cattle-snapshot') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('[cattle-snapshot] fetching Montana + National reports …')
  const [montana, national] = await Promise.all([fetchAndParseReport(), fetchAndParseNational()])

  const okMt = await upsertSnapshot(db, REPORT_SLUG, REPORT_URL, montana)
  const okNat = await upsertSnapshot(db, NATIONAL_SLUG, NATIONAL_URL, national)

  // Fail the run only if BOTH sources failed — partial success is still useful.
  if (!okMt && !okNat) process.exit(1)
}

main().catch(err => { console.error('[cattle-snapshot] threw:', err); process.exit(1) })

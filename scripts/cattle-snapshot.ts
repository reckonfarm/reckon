// ─── Cattle snapshot writer ──────────────────────────────────────────────────────
//
// Runs OFF Vercel (GitHub Actions, or locally for seeding) where www.ams.usda.gov
// is NOT 403-blocked. Fetches + parses the weekly Montana Livestock Auction Summary
// (report 1778) using the SAME parser the app would use, then UPSERTS the parsed
// snapshot into Supabase. Idempotent on (report_slug, report_week_start).
//
//   Local seed:  npx tsx scripts/cattle-snapshot.ts
//   CI:          same, with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
//
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js'
import { fetchAndParseReport, REPORT_SLUG, REPORT_URL } from '../lib/cattle-report-1778'

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  console.log(`[cattle-snapshot] fetching ${REPORT_URL} …`)
  const market = await fetchAndParseReport()

  if (market.status !== 'ok' || !market.reportWeekStart) {
    console.error('[cattle-snapshot] parse did not yield a usable snapshot — NOT writing.', {
      status: market.status, asOf: market.asOf, weekStart: market.reportWeekStart,
    })
    process.exit(1)
  }

  console.log('[cattle-snapshot] parsed:', {
    asOf: market.asOf,
    window: market.reportWindowLabel,
    steerClasses: market.feeder.steers.length,
    heiferClasses: market.feeder.heifers.length,
    cullCowAvg: market.cullCows?.avgCwt ?? null,
    bullAvg: market.slaughterBulls?.avgCwt ?? null,
    receipts: market.receipts.current,
  })

  const db = createClient(url, key, { auth: { persistSession: false } })
  const { error } = await db
    .from('cattle_market_snapshots')
    .upsert(
      {
        report_slug: REPORT_SLUG,
        report_week_start: market.reportWeekStart,
        report_week_end: market.reportWeekEnd,
        as_of_date: market.asOf,
        fetched_at: new Date().toISOString(),
        source_url: REPORT_URL,
        snapshot: market,
      },
      { onConflict: 'report_slug,report_week_start' },
    )

  if (error) {
    console.error('[cattle-snapshot] upsert failed:', error.message)
    process.exit(1)
  }
  console.log(`[cattle-snapshot] upserted week ${market.reportWeekStart} ✓`)
}

main().catch(err => { console.error('[cattle-snapshot] threw:', err); process.exit(1) })

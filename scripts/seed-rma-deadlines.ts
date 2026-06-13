// ─── RMA deadline seed (public reference data) ────────────────────────────────────
//
// Seeds public.rma_deadlines (migration 021) with USDA RMA / FSA crop-insurance
// deadline dates. PUBLIC reference data — every producer reads the same dates — so
// this writes with the SERVICE-ROLE client (the seed-counties.ts pattern), NOT the
// SSR/anon client. The dashboard reads the table back through the service-role client
// too (rma_deadlines is RLS-on-with-no-policies).
//
// The rows are defined INLINE below (like news-snapshot.ts owns its feed list) — they
// are not read from anywhere else. Upsert is idempotent on the natural key, so
// re-running never duplicates.
//
//   Local seed:  npx tsx scripts/seed-rma-deadlines.ts
//                (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// SCOPE — do NOT add dates that aren't verified here. There is intentionally NO
// production_reporting date and NO LRP row: LRP has no annual sales-closing deadline
// (coverage is bought per-endorsement, daily), so it deliberately does not belong in
// this annual-deadline table.

// @next/env must load before anything reads process.env (mirrors seed-counties.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Seed rows (inline — the only source of truth for this seed) ──────────────────
// All Montana, all statewide (county_fips = null), crop_year 2026, verified 2026-06-13.
// county_fips stays null because these dates apply state-wide (a county override would
// be a separate row with a real FIPS — none here).

interface DeadlineRow {
  state:           string
  county_fips:     string | null
  crop_or_program: string
  deadline_type:   string
  deadline_date:   string   // ISO date 'YYYY-MM-DD'
  crop_year:       number
  source:          string
  as_of:           string   // ISO date — when this date set was last verified
  notes:           string | null
}

const AS_OF = '2026-06-13'

const ROWS: DeadlineRow[] = [
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'spring_wheat', deadline_type: 'sales_closing',
    deadline_date: '2026-03-15', crop_year: 2026,
    source: 'USDA RMA Billings RO', as_of: AS_OF, notes: null,
  },
  // July 15 is TWO separate obligations that happen to share the date — an FSA
  // seeded-acres report and an RMA acreage report: two filings at two different agencies.
  // The AGENCY split is the meaningful axis, not crop (the producer knows their crops).
  // These are PROGRAM-LEVEL (every MT producer files them), so county_fips stays null and
  // they are NEVER crop-filtered — see PROGRAM_LEVEL in lib/rma-deadline-service.ts.
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'fsa_acreage', deadline_type: 'acreage_reporting',
    deadline_date: '2026-07-15', crop_year: 2026,
    source: 'USDA FSA Montana', as_of: AS_OF, notes: null,
  },
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'rma_acreage', deadline_type: 'acreage_reporting',
    deadline_date: '2026-07-15', crop_year: 2026,
    source: 'USDA RMA', as_of: AS_OF, notes: null,
  },
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'prf', deadline_type: 'sales_closing',
    deadline_date: '2025-12-01', crop_year: 2026,
    source: 'USDA RMA', as_of: AS_OF, notes: null,
  },
]

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic import so createClient evaluates after loadEnvConfig runs (seed-counties.ts).
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing env vars — ensure NEXT_PUBLIC_SUPABASE_URL and ' +
      'SUPABASE_SERVICE_ROLE_KEY are set in .env.local',
    )
  }

  // supabase-js eagerly resolves a WebSocket constructor for realtime and throws on
  // Node ≤20. We only do a REST upsert (no channels), so a never-instantiated transport
  // short-circuits that. (No 'ws' dependency.) — pattern from scripts/cattle-snapshot.ts.
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in seed-rma-deadlines') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — RMA Deadline Seed\n')
  console.log(`  rows     ${ROWS.length} inline (state MT, statewide, crop_year 2026)\n`)

  // Orphan cleanup — the July 15 obligations were RE-KEYED from crop slugs
  // (spring_wheat / perennial_forage) to agency slugs (fsa_acreage / rma_acreage). The
  // upsert below keys on (state, county_fips, crop_or_program, deadline_type, crop_year),
  // so the new agency rows INSERT fresh and would NOT overwrite the old crop rows — those
  // would linger as stale duplicates. Delete exactly the two superseded rows first.
  // Scoped to deadline_type='acreage_reporting' so the spring_wheat SALES_CLOSING (Mar 15)
  // row is left untouched. Idempotent: a no-op once they're already gone.
  const { data: deleted, error: delError } = await db
    .from('rma_deadlines')
    .delete()
    .eq('state', 'MT')
    .is('county_fips', null)
    .eq('crop_year', 2026)
    .eq('deadline_type', 'acreage_reporting')
    .in('crop_or_program', ['spring_wheat', 'perennial_forage'])
    .select('id')

  if (delError) {
    throw new Error(`orphan delete failed (nothing written): ${delError.message}`)
  }
  console.log(`  cleaned   ${deleted?.length ?? 0} superseded crop-keyed July 15 row(s)\n`)

  // One atomic upsert of all rows — either every row lands or none do (no partial write).
  // Idempotent on the natural key; NULLS NOT DISTINCT on the constraint makes the
  // null county_fips statewide rows dedupe instead of duplicating on re-run.
  // .select() returns the affected rows so we can report a real count.
  const { data, error } = await db
    .from('rma_deadlines')
    .upsert(ROWS, { onConflict: 'state,county_fips,crop_or_program,deadline_type,crop_year' })
    .select('id')

  if (error) {
    throw new Error(`upsert failed (nothing written): ${error.message}`)
  }

  const count = data?.length ?? 0
  console.log(`  done — upserted ${count} row${count !== 1 ? 's' : ''} (inserted or updated, idempotent).\n`)
}

main().catch(err => {
  console.error('\n  error:', err.message)
  process.exit(1)
})

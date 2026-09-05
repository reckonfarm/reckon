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
// (coverage is bought per-endorsement, daily — re-confirmed against the LRP Insurance
// Standards Handbook 2026), so it deliberately does not belong in this annual-deadline
// table. The LFP application row (an FSA disaster-program deadline, not crop insurance)
// IS carried — it's the program the whole dashboard is about — which is why the card's
// framing is "USDA programs", not "Crop insurance".
// Deliberately SKIPPED for now (add if a real user grows wheat): winter_wheat
// sales_closing 2026-09-30 and the FSA fall-seeded acreage date 2026-11-15.

// @next/env must load before anything reads process.env (mirrors seed-counties.ts).
import { loadEnvConfig } from '@next/env'
import { PROGRAM_DATES, programYearOf } from '../lib/programDates'
loadEnvConfig(process.cwd())

// ─── Seed rows (inline — the only source of truth for this seed) ──────────────────
// All Montana, all statewide (county_fips = null), verified 2026-07-27. The 2027-cycle
// roll-forward: PRF dates are CONFIRMED standing policy (RMA bulletin PM-21-051 — Dec 1
// for "2022 and succeeding crop years", sales closing AND acreage reporting); the
// spring dates are STANDARD-PRACTICE roll-forwards (2027 spring actuarials are not
// filed until ~Nov 2026), carried honestly in each row's `notes` with a re-verify
// marker. The expired 2026-cycle rows stay in the table untouched — the service
// filters deadline_date >= today, and crop_year is part of the natural key, so the
// new rows insert cleanly beside them.
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

const AS_OF = '2026-07-27'

// LFP application + PRF sales closing / acreage reporting come from
// lib/programDates.ts — THE single source of truth (Block 1). This seed only
// carries them into the table; the dashboard overrides the table from that file
// anyway (lib/rma-deadline-service.ts), so the two can never disagree on screen.
const PROGRAM_ROWS: DeadlineRow[] = PROGRAM_DATES.flatMap(pd => {
  const base = {
    state: 'MT', county_fips: null, crop_year: programYearOf(pd), as_of: pd.verifiedAt,
    deadline_date: pd.deadline,
  }
  if (pd.program === 'LFP') {
    return [{
      ...base, crop_or_program: 'lfp', deadline_type: 'application', source: 'USDA FSA',
      notes: `CCC-853 for ${pd.lossYear} grazing-year losses; March 1 following the loss year (${pd.source})`,
    }]
  }
  // PRF carries BOTH obligations, same day by design — PM-21-051 set sales closing AND
  // acreage reporting to Dec 1. Both CONFIRMED (standing policy, not an annual notice).
  const notes = 'Dec 1 standing date per RMA bulletin PM-21-051 (2022 and succeeding crop years)'
  return [
    { ...base, crop_or_program: 'prf', deadline_type: 'sales_closing',     source: 'USDA RMA', notes },
    { ...base, crop_or_program: 'prf', deadline_type: 'acreage_reporting', source: 'USDA RMA', notes },
  ]
})

const ROWS: DeadlineRow[] = [
  ...PROGRAM_ROWS,
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'spring_wheat', deadline_type: 'sales_closing',
    deadline_date: '2027-03-15', crop_year: 2027,
    source: 'USDA RMA Billings RO', as_of: AS_OF,
    notes: 'Standard date; 2027 actuarials unpublished — re-verify ~Dec 2026',
  },
  // July 15 is TWO separate obligations that happen to share the date — an FSA
  // seeded-acres report and an RMA acreage report: two filings at two different agencies.
  // The AGENCY split is the meaningful axis, not crop (the producer knows their crops).
  // These are PROGRAM-LEVEL (every MT producer files them), so county_fips stays null and
  // they are NEVER crop-filtered — see PROGRAM_LEVEL in lib/rma-deadline-service.ts.
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'fsa_acreage', deadline_type: 'acreage_reporting',
    deadline_date: '2027-07-15', crop_year: 2027,
    source: 'USDA FSA Montana', as_of: AS_OF,
    notes: 'Standard date; FSA announces annually — re-verify ~Dec 2026',
  },
  {
    state: 'MT', county_fips: null,
    crop_or_program: 'rma_acreage', deadline_type: 'acreage_reporting',
    deadline_date: '2027-07-15', crop_year: 2027,
    source: 'USDA RMA', as_of: AS_OF,
    notes: 'Inferred from RMA/FSA aligned common reporting dates — re-verify ~Dec 2026',
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
  // short-circuits that. (No 'ws' dependency.) — pattern from scripts/lrp-snapshot.ts.
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in seed-rma-deadlines') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — RMA Deadline Seed\n')
  console.log(`  rows     ${ROWS.length} inline (state MT, statewide, 2027-cycle roll-forward, as of ${AS_OF})\n`)

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

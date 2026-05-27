// Run with: npx tsx lib/seed-counties.ts
// @next/env must be loaded before any import that reads process.env
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Config ───────────────────────────────────────────────────────────────────

// Official Census Bureau national county reference file (2020 vintage).
// Columns (pipe-delimited): STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT
const CENSUS_URL =
  'https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt'

const BATCH_SIZE = 500

// ─── Types ────────────────────────────────────────────────────────────────────

interface CountyRow {
  fips: string  // zero-padded 5-digit (e.g. "06037")
  name: string  // full official name (e.g. "Los Angeles County")
  state: string // two-letter abbreviation (e.g. "CA")
}

// ─── Fetch + parse ────────────────────────────────────────────────────────────

async function fetchCensusCounties(): Promise<CountyRow[]> {
  console.log(`  source   ${CENSUS_URL}`)
  const res = await fetch(CENSUS_URL)
  if (!res.ok) {
    throw new Error(`Census download failed: ${res.status} ${res.statusText}`)
  }

  const text = await res.text()
  const lines = text.trim().split('\n').slice(1) // drop header row

  const rows: CountyRow[] = []
  for (const raw of lines) {
    // File is pipe-delimited: STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT
    const cols = raw.split('|').map(s => s.trim())
    const stateAbbr = cols[0]
    const statefp   = cols[1]
    const countyfp  = cols[2]
    const countyName = cols[4] // index 3 is COUNTYNS (ANSI code), name is at 4
    if (!statefp || !countyfp || !countyName) continue

    rows.push({
      fips: statefp.padStart(2, '0') + countyfp.padStart(3, '0'),
      name: countyName,
      state: stateAbbr,
    })
  }

  return rows
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic import ensures createClient evaluates after loadEnvConfig runs
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing env vars — ensure NEXT_PUBLIC_SUPABASE_URL and ' +
      'SUPABASE_SERVICE_ROLE_KEY are set in .env.local',
    )
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  console.log('\nDryline — County Seed\n')
  const counties = await fetchCensusCounties()
  console.log(`  parsed   ${counties.length} county records\n`)

  let upserted = 0
  const batches = Math.ceil(counties.length / BATCH_SIZE)

  for (let i = 0; i < counties.length; i += BATCH_SIZE) {
    const batch = counties.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    const { error } = await db
      .from('counties')
      .upsert(batch, { onConflict: 'fips' })

    if (error) {
      throw new Error(`Batch ${batchNum}/${batches} failed: ${error.message}`)
    }

    upserted += batch.length
    process.stdout.write(`\r  upserted ${upserted} / ${counties.length}`)
  }

  console.log(`\n\n  done — ${upserted} counties seeded successfully.\n`)
}

main().catch(err => {
  console.error('\n  error:', err.message)
  process.exit(1)
})

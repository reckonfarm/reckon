#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

// ─── Config ───────────────────────────────────────────────────────────────────

const USDM_API_BASE = 'https://usdmdataservices.unl.edu/api'
const WEEKS_BACK = 52
const BATCH_SIZE = 500
const STATE_CONCURRENCY = 10

const USDM_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY','PR',
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface USDMRecord {
  mapDate: string
  fips:    string
  county:  string
  state:   string
  none:    number
  d0:      number
  d1:      number
  d2:      number
  d3:      number
  d4:      number
}

// ─── Helpers (mirrored from lib/drought-service.ts — do not import it directly,
//             it carries the server-only guard) ────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function getMostRecentTuesday(): Date {
  const today = new Date()
  const day = today.getUTCDay() // 0=Sun … 6=Sat
  // (day + 5) % 7 maps Tue→0, so subtract that many days to land on Tuesday
  const daysBack = (day + 5) % 7
  const tuesday = new Date(today)
  tuesday.setUTCDate(today.getUTCDate() - daysBack)
  tuesday.setUTCHours(0, 0, 0, 0)
  return tuesday
}

// Per 7 CFR 1416: highest D-level where ANY area of the county > 0%
function calcMaxCategory(d0: number, d1: number, d2: number, d3: number, d4: number): number {
  if (d4 > 0) return 4
  if (d3 > 0) return 3
  if (d2 > 0) return 2
  if (d1 > 0) return 1
  if (d0 > 0) return 0
  return -1
}

// ─── USDM fetch (same batching / dedup logic as drought-service) ──────────────

async function fetchUSDMWeek(tuesday: Date): Promise<USDMRecord[]> {
  const date = toISODate(tuesday)
  const allRecords: USDMRecord[] = []
  const seenFips = new Set<string>()

  for (let i = 0; i < USDM_STATES.length; i += STATE_CONCURRENCY) {
    const batch = USDM_STATES.slice(i, i + STATE_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (aoi) => {
        const url =
          `${USDM_API_BASE}/CountyStatistics/` +
          `GetDroughtSeverityStatisticsByAreaPercent` +
          `?aoi=${aoi}&startdate=${date}&enddate=${date}&statisticsType=1`
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) {
          throw new Error(`USDM API ${res.status} for aoi=${aoi} date=${date}`)
        }
        return res.json() as Promise<USDMRecord[]>
      }),
    )

    for (const records of results) {
      for (const r of records) {
        const fips = r.fips.padStart(5, '0')
        if (!seenFips.has(fips)) {
          seenFips.add(fips)
          allRecords.push({ ...r, fips })
        }
      }
    }
  }

  return allRecords
}

// ─── Upsert helper ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertInBatches(
  db: ReturnType<typeof createClient<any>>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await db.from(table).upsert(batch, { onConflict })
    if (error) throw new Error(`Upsert into "${table}" failed: ${error.message}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient<any>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Build list of WEEKS_BACK Tuesdays, oldest first
  const latestTuesday = getMostRecentTuesday()
  const tuesdays: Date[] = []
  for (let w = WEEKS_BACK - 1; w >= 0; w--) {
    tuesdays.push(addDays(latestTuesday, -7 * w))
  }

  console.log(
    `\nBackfilling ${WEEKS_BACK} weeks` +
    ` (${toISODate(tuesdays[0])} → ${toISODate(tuesdays[tuesdays.length - 1])})\n`,
  )

  // fipsToId is built once from the first successful week and reused for all others.
  // Counties are static — there is no need to re-query them each week.
  let fipsToId: Record<string, number> = {}
  let mapBuilt = false

  let totalDrought = 0
  let totalObs     = 0
  let skipped      = 0

  for (let wi = 0; wi < tuesdays.length; wi++) {
    const tuesday         = tuesdays[wi]
    const weekDate        = toISODate(tuesday)
    // USDM data is as-of Tuesday; the map is published on the following Thursday
    const releaseThursday = toISODate(addDays(tuesday, 2))
    const prefix          = `[${String(wi + 1).padStart(2, ' ')}/${WEEKS_BACK}] ${weekDate}`

    process.stdout.write(`${prefix} — fetching USDM...`)

    let records: USDMRecord[]
    try {
      records = await fetchUSDMWeek(tuesday)
    } catch (err) {
      console.log(` SKIP — ${(err as Error).message}`)
      skipped++
      continue
    }

    if (records.length === 0) {
      console.log(' SKIP — no data returned')
      skipped++
      continue
    }

    process.stdout.write(` ${records.length} records`)

    // First successful week: upsert all counties and build the fipsToId lookup.
    if (!mapBuilt) {
      process.stdout.write(' — seeding counties...')
      const countyRows = records.map(r => ({ fips: r.fips, name: r.county, state: r.state }))
      await upsertInBatches(db, 'counties', countyRows as Record<string, unknown>[], 'fips')

      // Load ids back out; chunk to stay under the 1 000-row .in() cap
      const CHUNK = 1000
      for (let ci = 0; ci < countyRows.length; ci += CHUNK) {
        const slice = countyRows.slice(ci, ci + CHUNK).map(r => r.fips)
        const { data, error } = await db
          .from('counties')
          .select('id, fips')
          .in('fips', slice)
        if (error) throw new Error(`County id lookup failed: ${error.message}`)
        for (const row of (data ?? [])) {
          fipsToId[row.fips as string] = row.id as number
        }
      }
      mapBuilt = true
    }

    // Build drought_data rows
    const now = new Date().toISOString()
    const droughtRows = records.flatMap(r => {
      const countyId = fipsToId[r.fips]
      if (!countyId) return []
      return [{
        county_id:  countyId,
        week_date:  weekDate,
        d0:         r.d0,
        d1:         r.d1,
        d2:         r.d2,
        d3:         r.d3,
        d4:         r.d4,
        updated_at: now,
      }]
    })

    await upsertInBatches(db, 'drought_data', droughtRows as Record<string, unknown>[], 'county_id,week_date')

    // Build drought_observations rows (max_category per county per release Thursday)
    const obsRows = droughtRows.flatMap(r => {
      const maxCat = calcMaxCategory(r.d0, r.d1, r.d2, r.d3, r.d4)
      if (maxCat < 0) return []
      return [{
        county_id:     r.county_id,
        max_category:  maxCat,
        release_date:  releaseThursday,
        valid_through: weekDate,
      }]
    })

    await upsertInBatches(db, 'drought_observations', obsRows as Record<string, unknown>[], 'county_id,release_date')

    totalDrought += droughtRows.length
    totalObs     += obsRows.length

    console.log(
      ` — ${droughtRows.length} drought_data, ${obsRows.length} observations`,
    )
  }

  console.log(`
─────────────────────────────────────────────────
Backfill complete.
  Weeks processed : ${WEEKS_BACK - skipped} / ${WEEKS_BACK}
  Weeks skipped   : ${skipped}
  drought_data    : ${totalDrought.toLocaleString()} rows upserted
  observations    : ${totalObs.toLocaleString()} rows upserted
─────────────────────────────────────────────────`)
}

main().catch(err => {
  console.error('\nFATAL:', err)
  process.exit(1)
})

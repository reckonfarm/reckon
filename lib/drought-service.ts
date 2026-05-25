import 'server-only'
import { createServiceClient } from './supabase'

// USDM REST API — docs: https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx
const USDM_API_BASE = 'https://usdmdataservices.unl.edu/api'

// The API requires an aoi (area of interest) — there is no all-counties endpoint.
// Query each state/territory individually and merge; deduplicate by FIPS.
const USDM_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY','PR',
]

// Supabase recommends staying well under the 1 MB payload limit per request.
// ~3,143 US counties split into 500-row batches is a safe ceiling.
const BATCH_SIZE = 500

// Fetch 10 states at a time to keep wall-clock time reasonable without hammering the API.
const STATE_CONCURRENCY = 10

// ─── Sanity-check counties ────────────────────────────────────────────────────
// Logged after upsert to confirm non-zero d0–d4 values from the API.

const SANITY_FIPS: Array<{ fips: string; label: string }> = [
  { fips: '48011', label: 'Armstrong TX (West Texas)' },
  { fips: '31003', label: 'Antelope NE'               },
  { fips: '30069', label: 'Petroleum MT'              },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface USDMRecord {
  mapDate: string   // 'YYYY-MM-DDTHH:mm:ss' ISO datetime
  fips:    string   // 5-digit FIPS (padded before storage)
  county:  string
  state:   string   // two-letter abbreviation
  none:    number   // % of county with no drought
  d0:      number
  d1:      number
  d2:      number
  d3:      number
  d4:      number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// USDM data is as-of Tuesday; the map is published on the following Thursday.
// We query the API using the Tuesday date (the data-as-of date).
// release_date stored in drought_observations uses Thursday (+2 days).
function getMostRecentTuesday(): Date {
  const today = new Date()
  const day = today.getUTCDay() // 0 = Sun … 6 = Sat
  // (day + 5) % 7  maps  Tue→0, Wed→1, Thu→2, Fri→3, Sat→4, Sun→5, Mon→6
  const daysBack = (day + 5) % 7
  const tuesday = new Date(today)
  tuesday.setUTCDate(today.getUTCDate() - daysBack)
  tuesday.setUTCHours(0, 0, 0, 0)
  return tuesday
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10) // "YYYY-MM-DD"
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

// Per 7 CFR 1416: a county is designated at the highest D-level
// where ANY area of the county has coverage > 0%.
function calcMaxCategory(
  d0: number, d1: number, d2: number, d3: number, d4: number,
): number {
  if (d4 > 0) return 4
  if (d3 > 0) return 3
  if (d2 > 0) return 2
  if (d1 > 0) return 1
  if (d0 > 0) return 0
  return -1
}

async function fetchUSDMData(releaseDate: Date): Promise<USDMRecord[]> {
  const date = toISODate(releaseDate)

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
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        if (!res.ok) {
          throw new Error(`USDM API returned ${res.status} ${res.statusText} for aoi=${aoi} date=${date}`)
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

  if (allRecords.length === 0) {
    throw new Error(`USDM returned no records for ${date}. Data may not be published yet.`)
  }

  console.log(`[drought] fetched ${allRecords.length} county records from USDM for ${date}`)
  return allRecords
}

async function upsertInBatches<T extends object>(
  db: ReturnType<typeof createServiceClient>,
  table: string,
  rows: T[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await db.from(table).upsert(batch, { onConflict })
    if (error) throw new Error(`Upsert into "${table}" failed: ${error.message}`)
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchAndStoreDroughtData(): Promise<{
  weekDate: string
  upserted: number
  observations: number
}> {
  const db = createServiceClient()

  // Step 1 — Determine this week's release date
  const releaseDate = getMostRecentTuesday()
  const weekDate = toISODate(releaseDate)
  // USDM publishes on Thursday; weekDate is the Tuesday data-as-of date
  const releaseThursday = toISODate(addDays(releaseDate, 2))

  // Step 2 — Fetch county-level drought statistics from USDM (all states via aoi)
  const records = await fetchUSDMData(releaseDate)

  // Step 3 — Upsert counties so every FIPS row exists before we FK into it.
  const countyRows = records.map(r => ({
    fips:  r.fips,   // already padded in fetchUSDMData
    name:  r.county,
    state: r.state,
  }))

  await upsertInBatches(db, 'counties', countyRows, 'fips')

  // Step 4 — Build FIPS → county_id map for the FK join.
  // Chunk the .in() query so no single request exceeds Supabase's 1,000-row default cap.
  const fipsList = [...new Set(countyRows.map(r => r.fips))]
  const CHUNK = 1000
  const allCountyData: Array<{ id: number; fips: string }> = []
  for (let i = 0; i < fipsList.length; i += CHUNK) {
    const { data, error } = await db
      .from('counties')
      .select('id, fips')
      .in('fips', fipsList.slice(i, i + CHUNK))
    if (error) throw new Error(`County id lookup failed: ${error.message}`)
    if (data) allCountyData.push(...data)
  }

  const fipsToId = Object.fromEntries(
    allCountyData.map(c => [c.fips as string, c.id as number]),
  )

  // Step 5 — Build drought_data rows (skip any FIPS that failed to resolve)
  const now = new Date().toISOString()
  const droughtRows = records.flatMap(r => {
    const countyId = fipsToId[r.fips]
    if (!countyId) return []
    return [{
      county_id: countyId,
      week_date: weekDate,
      d0: r.d0,
      d1: r.d1,
      d2: r.d2,
      d3: r.d3,
      d4: r.d4,
      updated_at: now,
    }]
  })

  // Step 6 — Upsert drought data; unique constraint is (county_id, week_date)
  await upsertInBatches(db, 'drought_data', droughtRows, 'county_id,week_date')

  // Step 7 — Derive and upsert drought_observations (max category per county).
  // release_date = Thursday (USDM publish day); valid_through = Tuesday (data as-of).
  const obsRows = droughtRows.flatMap(r => {
    const maxCat = calcMaxCategory(r.d0, r.d1, r.d2, r.d3, r.d4)
    if (maxCat < 0) return []
    return [{
      county_id:    r.county_id,
      max_category: maxCat,
      release_date: releaseThursday,
      valid_through: weekDate,
    }]
  })
  await upsertInBatches(db, 'drought_observations', obsRows, 'county_id,release_date')

  // Step 8 — Sanity check: confirm non-zero d0–d4 for known-drought counties
  const byFips = Object.fromEntries(records.map(r => [r.fips, r]))
  console.log(`\n[drought] stored ${droughtRows.length} county-week rows, ${obsRows.length} observations (week ${weekDate})`)
  console.log('[drought] ── Sanity check — verify non-zero drought values ──────────────')
  for (const { fips, label } of SANITY_FIPS) {
    const r = byFips[fips]
    if (!r) { console.log(`  ${label} (${fips}): NOT IN API RESPONSE`); continue }
    console.log(`  ${label} (${fips}): d0=${r.d0} d1=${r.d1} d2=${r.d2} d3=${r.d3} d4=${r.d4}`)
  }
  console.log('[drought] ──────────────────────────────────────────────────────────────\n')

  return { weekDate, upserted: droughtRows.length, observations: obsRows.length }
}

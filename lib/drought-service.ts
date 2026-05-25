import 'server-only'
import { createServiceClient } from './supabase'

// USDM REST API — docs: https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx
const USDM_API_BASE = 'https://usdmdataservices.unl.edu/api'

// Supabase recommends staying well under the 1 MB payload limit per request.
// ~3,143 US counties split into 500-row batches is a safe ceiling.
const BATCH_SIZE = 500

// ─── Types ────────────────────────────────────────────────────────────────────

interface USDMRecord {
  MapDate: string // "20240102" — YYYYMMDD
  FIPS: string    // may arrive without leading zero on some states
  County: string
  State: string   // two-letter abbreviation
  None: number    // % of county with no drought
  D0: number
  D1: number
  D2: number
  D3: number
  D4: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// USDM publishes every Tuesday. We want the most recently completed release,
// so if today IS Tuesday we still use it (data lands in the afternoon).
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

async function fetchUSDMData(releaseDate: Date): Promise<USDMRecord[]> {
  const date = toISODate(releaseDate)
  const url =
    `${USDM_API_BASE}/CountyStatistics/` +
    `GetDroughtSeverityStatisticsByAreaPercent` +
    `?startdate=${date}&enddate=${date}&statisticsType=1`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store', // always fetch fresh; never use Next.js data cache here
  })

  if (!res.ok) {
    throw new Error(`USDM API returned ${res.status} ${res.statusText} for ${date}`)
  }

  const data: unknown = await res.json()

  if (!Array.isArray(data) || data.length === 0) {
    // Tuesday data may not be published until afternoon ET — cron timing matters
    throw new Error(`USDM returned no records for ${date}. Data may not be published yet.`)
  }

  return data as USDMRecord[]
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
}> {
  const db = createServiceClient()

  // Step 1 — Determine this week's release date
  const releaseDate = getMostRecentTuesday()
  const weekDate = toISODate(releaseDate)

  // Step 2 — Fetch county-level drought statistics from USDM
  const records = await fetchUSDMData(releaseDate)

  // Step 3 — Upsert counties so every FIPS row exists before we FK into it.
  //           Leading-zero FIPS codes can arrive stripped (e.g. "1001" vs "01001").
  const countyRows = records.map(r => ({
    fips: r.FIPS.padStart(5, '0'),
    name: r.County,
    state: r.State,
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
    const fips = r.FIPS.padStart(5, '0')
    const countyId = fipsToId[fips]
    if (!countyId) return []
    return [
      {
        county_id: countyId,
        week_date: weekDate,
        d0: r.D0,
        d1: r.D1,
        d2: r.D2,
        d3: r.D3,
        d4: r.D4,
        updated_at: now,
      },
    ]
  })

  // Step 6 — Upsert drought data; unique constraint is (county_id, week_date)
  await upsertInBatches(db, 'drought_data', droughtRows, 'county_id,week_date')

  return { weekDate, upserted: droughtRows.length }
}

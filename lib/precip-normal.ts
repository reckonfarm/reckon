import 'server-only'

const ACIS_BASE = 'https://data.rcc-acis.org'

export interface PrecipNormalData {
  stationName: string
  stationUid: number
  distanceMiles: number
  dailyData: Array<{
    date: string
    actualCumulative: number
    normalCumulative: number
  }>
  ytdActual: number
  ytdNormal: number
  deficit: number
  deficitPct: number
  dataThrough: string | null  // null = complete; date string = last day with valid actual
}

// Result of a precip lookup:
//   PrecipNormalData       — a usable series from a station that clears both floors
//   'no_qualifying_station'— stations exist near the county but none have usable
//                            30-year normals AND enough YTD reporting history
//   null                   — transient error / no rows / no stations at all
export type PrecipNormalResult = PrecipNormalData | 'no_qualifying_station' | null

type AcisStn = {
  meta?: { uid?: number; name?: string; ll?: [number, number] }
  data?: Array<[string, string]>  // [actual, normal] per day; date is implicit by index from sdate
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

function parseValue(v: string): number | null {
  if (v === 'M') return null
  if (v === 'T') return 0
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

// A station whose most recent valid reading is older than this many days beyond
// the window end is treated as stale ("offline"), triggering the radius search
// for a fresher nearby station. ACIS already lags ~4 days, so a healthy station
// shows a small trailing gap; a large one means the station has gone quiet.
const STALE_TRAILING_DAYS = 5

// Minimum share of the YTD window a station must have valid actual readings for
// before it can be selected. A YTD cumulative built from a mostly-missing station
// under-counts and reads as a fake deficit; below half a year of daily reports
// the comparison against the climatological normal isn't honest. 0.50 cleanly
// separates real recorders from near-empty COOP sites (e.g. Petroleum County:
// ~87% vs 0–1% coverage).
const COVERAGE_FLOOR = 0.5

interface StnQuality {
  latestValidIdx: number  // index of most recent valid actual reading; -1 if none
  actValid:       number  // count of valid actual readings in the window
  hasNormals:     boolean // station carries usable 30-year normals
  total:          number  // window length in days
}

// Each station's daily rows are [actual, normal]; the date is implicit by index.
function assessStation(stn: AcisStn): StnQuality {
  const rows = stn.data ?? []
  let latestValidIdx = -1
  let actValid = 0
  let hasNormals = false
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]?.[0]
    const n = rows[i]?.[1]
    if (a !== 'M' && a != null) { actValid++; latestValidIdx = i }
    if (n !== 'M' && n != null) hasNormals = true
  }
  return { latestValidIdx, actValid, hasNormals, total: rows.length }
}

// Floors applied BEFORE recency: a station must carry usable normals AND clear the
// coverage floor. Recency never overrides either — overriding them was the
// recency-first regression that picked a 2-of-146, normal-less station.
function clearsFloors(q: StnQuality): boolean {
  return q.hasNormals && q.total > 0 && q.actValid >= Math.floor(q.total * COVERAGE_FLOOR)
}

// Among stations clearing both floors, keep the freshest (latest valid reading),
// breaking ties by most valid readings. Returns null when none qualify.
function pickQualifiedStation(stations: AcisStn[]): { stn: AcisStn; q: StnQuality } | null {
  let best: { stn: AcisStn; q: StnQuality } | null = null
  for (const stn of stations) {
    const q = assessStation(stn)
    if (!clearsFloors(q)) continue
    if (
      best == null ||
      q.latestValidIdx > best.q.latestValidIdx ||
      (q.latestValidIdx === best.q.latestValidIdx && q.actValid > best.q.actValid)
    ) {
      best = { stn, q }
    }
  }
  return best
}

// Trailing missing days between a qualifier's last valid reading and window end.
function trailingGap(best: { q: StnQuality } | null): number {
  if (best == null) return Infinity
  return (best.q.total - 1) - best.q.latestValidIdx
}

export async function getPrecipNormal(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalResult> {
  const today = new Date()
  const edate = new Date(today)
  edate.setDate(today.getDate() - 4)

  const year = today.getFullYear()
  const sdate = `${year}-01-01`
  const edateStr = edate.toISOString().slice(0, 10)

  try {
    // Step 1: find best station for this county (fewest missing values)
    const multiRes = await fetch(`${ACIS_BASE}/MultiStnData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        county: fips,
        meta: ['uid', 'name', 'll'],
        sdate,
        edate: edateStr,
        elems: [{ name: 'pcpn' }, { name: 'pcpn', normal: '1' }],
        output: 'json',
      }),
      next: { revalidate: 86400 },
    })
    if (!multiRes.ok) return null

    const multiData = await multiRes.json() as { data?: AcisStn[] }

    // Pick the freshest in-county station that clears the normals + coverage floors.
    let best = pickQualifiedStation(multiData.data ?? [])
    let fromRadius = false

    // Staleness-gated radius search (50 → 100 → 150 mi): run it when there is NO
    // qualifying in-county station OR the best one has gone quiet. Only adopt a
    // neighbor that ALSO clears both floors AND is fresher — never trade a complete
    // station for a near-empty one just because it reported more recently. If
    // nothing nearby qualifies, keep the in-county qualifier and let the pre-period
    // clip + "station offline" note tell the truth.
    if ((best == null || trailingGap(best) > STALE_TRAILING_DAYS) && lat != null && lon != null) {
      for (const distance of [50, 100, 150]) {
        const radiusRes = await fetch(`${ACIS_BASE}/MultiStnData`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ll: [lon, lat],
            distance,
            meta: ['uid', 'name', 'll'],
            sdate,
            edate: edateStr,
            elems: [{ name: 'pcpn' }, { name: 'pcpn', normal: '1' }],
            output: 'json',
          }),
          next: { revalidate: 86400 },
        })
        if (!radiusRes.ok) continue
        const radiusData = await radiusRes.json() as { data?: AcisStn[] }
        const radiusBest = pickQualifiedStation(radiusData.data ?? [])
        if (radiusBest) {
          const curIdx = best ? best.q.latestValidIdx : -2
          if (radiusBest.q.latestValidIdx > curIdx) {
            best = radiusBest
            fromRadius = true
          }
          if (trailingGap(best) <= STALE_TRAILING_DAYS) break
        }
      }
    }

    // No station with usable normals AND enough reporting history anywhere in
    // range — honest explicit state; never render a card/deficit against a 0 normal.
    if (best == null) return 'no_qualifying_station'
    const bestStation = best.stn

    // ACIS returns ll as [longitude, latitude]
    const distanceMiles =
      fromRadius && lat != null && lon != null && bestStation.meta?.ll
        ? Math.round(haversineMiles(lat, lon, bestStation.meta.ll[1], bestStation.meta.ll[0]))
        : 0

    const uid = bestStation.meta?.uid
    if (uid == null) return null

    // Step 2: fetch daily actuals + 30-year normals for best station
    const stnRes = await fetch(`${ACIS_BASE}/StnData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid,
        sdate,
        edate: edateStr,
        elems: [{ name: 'pcpn' }, { name: 'pcpn', normal: '1' }],
        output: 'json',
      }),
      next: { revalidate: 86400 },
    })
    if (!stnRes.ok) return null

    const stnData = await stnRes.json() as {
      meta?: { name?: string }
      data?: Array<[string, string, string]>
    }

    const rows = stnData.data ?? []
    if (rows.length === 0) return null

    const stationName = stnData.meta?.name ?? 'Unknown Station'

    // Step 3: compute running cumulative totals
    let dailyData: PrecipNormalData['dailyData'] = []
    let actualCum = 0
    let normalCum = 0
    let lastValidIdx = -1

    for (let i = 0; i < rows.length; i++) {
      const [date, actualRaw, normalRaw] = rows[i]
      const actual = parseValue(actualRaw)
      const normal = parseValue(normalRaw)
      if (actual !== null) { actualCum += actual; lastValidIdx = i }
      if (normal !== null) normalCum += normal
      dailyData.push({ date, actualCumulative: actualCum, normalCumulative: normalCum })
    }

    if (dailyData.length === 0 || lastValidIdx === -1) return null

    // Trim trailing missing days so the chart and deficit both stop at the last
    // date with a valid actual reading — prevents the normal line from running
    // ahead and inflating the apparent deficit when a station goes offline.
    let dataThrough: string | null = null
    if (lastValidIdx < rows.length - 1) {
      dailyData = dailyData.slice(0, lastValidIdx + 1)
      dataThrough = dailyData[lastValidIdx].date
    }

    const last = dailyData[dailyData.length - 1]
    const ytdActual = last.actualCumulative
    const ytdNormal = last.normalCumulative
    const deficit = ytdActual - ytdNormal
    const deficitPct = ytdNormal > 0 ? (deficit / ytdNormal) * 100 : 0

    return { stationName, stationUid: uid, distanceMiles, dailyData, ytdActual, ytdNormal, deficit, deficitPct, dataThrough }
  } catch {
    return null
  }
}

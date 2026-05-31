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

type AcisStn = {
  meta?: { uid?: number; name?: string; ll?: [number, number] }
  data?: Array<[string]>
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

// A station's recency + completeness over the daily window. latestValidIdx is the
// array index (≈ day offset from sdate) of the most recent non-missing reading;
// higher = more recent. missing counts 'M'/absent days. We select on recency so
// the station reporting NOW wins over one merely more complete across the year.
function stationScore(stn: AcisStn): { latestValidIdx: number; missing: number } {
  const rows = stn.data ?? []
  let latestValidIdx = -1
  let missing = 0
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]?.[0]
    if (v === 'M' || v == null) missing++
    else latestValidIdx = i
  }
  return { latestValidIdx, missing }
}

// Prefer the most recent valid reading; break ties by fewest missing days.
function pickFreshestStation(stations: AcisStn[]): AcisStn | null {
  let best: AcisStn | null = null
  let bestIdx = -2
  let bestMissing = Infinity
  for (const stn of stations) {
    const { latestValidIdx, missing } = stationScore(stn)
    if (latestValidIdx > bestIdx || (latestValidIdx === bestIdx && missing < bestMissing)) {
      best = stn
      bestIdx = latestValidIdx
      bestMissing = missing
    }
  }
  return best
}

// Trailing missing days between a station's last valid reading and the window end.
function trailingGapDays(stn: AcisStn | null): number {
  if (!stn) return Infinity
  const rows = stn.data ?? []
  const { latestValidIdx } = stationScore(stn)
  if (latestValidIdx < 0) return Infinity
  return (rows.length - 1) - latestValidIdx
}

export async function getPrecipNormal(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalData | null> {
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
        elems: 'pcpn',
        output: 'json',
      }),
      next: { revalidate: 86400 },
    })
    if (!multiRes.ok) return null

    const multiData = await multiRes.json() as { data?: AcisStn[] }

    // Pick the freshest in-county station (most recent reading, then completeness).
    let bestStation = pickFreshestStation(multiData.data ?? [])
    let fromRadius = false

    // Radius fallback (50 → 100 → 150 mi) when the county has NO station OR its
    // best station has gone quiet. We adopt a nearby station only when it is
    // strictly fresher than what we have, and stop expanding the moment we land a
    // non-stale one. If nothing fresher exists in range, we keep the in-county
    // station and let the pre-period clip + "station offline" note tell the truth.
    if ((bestStation == null || trailingGapDays(bestStation) > STALE_TRAILING_DAYS) && lat != null && lon != null) {
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
            elems: 'pcpn',
            output: 'json',
          }),
          next: { revalidate: 86400 },
        })
        if (!radiusRes.ok) continue
        const radiusData = await radiusRes.json() as { data?: AcisStn[] }
        const radiusBest = pickFreshestStation(radiusData.data ?? [])
        if (radiusBest) {
          const curIdx = bestStation ? stationScore(bestStation).latestValidIdx : -2
          if (stationScore(radiusBest).latestValidIdx > curIdx) {
            bestStation = radiusBest
            fromRadius = true
          }
          if (trailingGapDays(bestStation) <= STALE_TRAILING_DAYS) break
        }
      }
    }

    if (bestStation == null) return null

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

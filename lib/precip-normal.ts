import 'server-only'

const ACIS_BASE = 'https://data.rcc-acis.org'
const PRISM_GRID = '21'          // ACIS grid 21 = PRISM daily precip — whole-county coverage, no station outages
const REVALIDATE = 86400         // 24h Data Cache

// A station whose most recent valid reading is older than this many days beyond
// the window end is treated as stale ("offline"), triggering the radius search.
const STALE_TRAILING_DAYS = 5

// Minimum share of the YTD window a station must have valid actual readings for
// before it can be selected as a gauge. A cumulative built from a mostly-missing
// station under-counts and reads as a fake deficit; below half a year of daily
// reports the comparison against the climatological normal isn't honest.
const COVERAGE_FLOOR = 0.5

export interface DailyCumulative {
  date: string
  actualCumulative: number
  normalCumulative: number
}

// Secondary "nearest gauge" readout — a real COOP station, shown alongside the
// grid estimate and used as the full fallback when the grid is unavailable.
export interface GaugeReadout {
  name: string
  distanceMiles: number
  through: string | null  // last valid actual date; null = current through window end
  ytdActual: number
  ytdNormal: number
  deficit: number
  deficitPct: number
}

export interface PrecipNormalData {
  source: 'grid' | 'station'   // grid = PRISM county estimate (primary); station = gauge fallback
  label: string                // honest source label for the card
  distanceMiles: number        // gauge distance from county center (0 for grid / in-county)
  dailyData: DailyCumulative[]
  ytdActual: number
  ytdNormal: number
  deficit: number
  deficitPct: number
  dataThrough: string | null   // last valid actual date; null = current through window end
  gauge: GaugeReadout | null   // secondary gauge readout (present only when source = 'grid')
}

// Result of a precip lookup:
//   PrecipNormalData       — a usable series (grid primary, or station fallback)
//   'no_qualifying_station'— no grid AND no station with usable normals + history
//   null                   — transient error / no data at all
export type PrecipNormalResult = PrecipNormalData | 'no_qualifying_station' | null

type AcisStn = {
  meta?: { uid?: number; name?: string; ll?: [number, number] }
  data?: Array<[string, string]>  // [actual, normal] per day; date implicit by index from sdate
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

// Station values: 'M' = missing, 'T' = trace (counts as 0).
function parseValue(v: string | null | undefined): number | null {
  if (v === 'M' || v == null) return null
  if (v === 'T') return 0
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

// Grid values are numeric; ACIS encodes missing as -999.
function parseGridValue(v: number | string): number | null {
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (!Number.isFinite(n) || n <= -900) return null
  return n
}

// Bounding box (W,S,E,N) roughly `miles` around a point — ACIS MultiStnData area
// specifier. NOTE: ACIS does NOT support an `ll`+`distance` radius for stations
// (it silently returns zero), so we use bbox and filter by true great-circle dist.
function bboxFor(lat: number, lon: number, miles: number): string {
  const dLat = miles / 69
  const dLon = miles / (69 * Math.cos((lat * Math.PI) / 180))
  return `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`
}

interface StnQuality {
  latestValidIdx: number  // index of most recent valid actual; -1 if none
  actValid:       number  // count of valid actual readings
  hasNormals:     boolean // station carries usable 30-year normals
  total:          number  // window length in days
}

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

// Floors applied BEFORE recency: usable normals AND coverage. Recency never
// overrides either (that was the recency-first regression).
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

function trailingGap(best: { q: StnQuality } | null): number {
  if (best == null) return Infinity
  return (best.q.total - 1) - best.q.latestValidIdx
}

// ─── Selection: freshest qualifying gauge, county first then bbox radius ───────

interface SelectedStation {
  name: string
  distanceMiles: number
  rows: Array<[string, string, string]>  // dated [date, actual, normal] from StnData
}

async function selectStation(
  fips: string,
  lat: number | null,
  lon: number | null,
  sdate: string,
  edate: string,
): Promise<SelectedStation | null> {
  const elems = [{ name: 'pcpn' }, { name: 'pcpn', normal: '1' }]

  const countyRes = await fetch(`${ACIS_BASE}/MultiStnData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ county: fips, meta: ['uid', 'name', 'll'], sdate, edate, elems, output: 'json' }),
    next: { revalidate: REVALIDATE },
  })
  if (!countyRes.ok) return null
  const countyData = await countyRes.json() as { data?: AcisStn[] }
  let best = pickQualifiedStation(countyData.data ?? [])

  // Staleness-gated radius search via bbox (50 → 100 → 150 mi). Only adopt a
  // neighbor that ALSO clears both floors AND is fresher.
  if ((best == null || trailingGap(best) > STALE_TRAILING_DAYS) && lat != null && lon != null) {
    for (const distance of [50, 100, 150]) {
      const radiusRes = await fetch(`${ACIS_BASE}/MultiStnData`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: bboxFor(lat, lon, distance), meta: ['uid', 'name', 'll'], sdate, edate, elems, output: 'json' }),
        next: { revalidate: REVALIDATE },
      })
      if (!radiusRes.ok) continue
      const radiusData = await radiusRes.json() as { data?: AcisStn[] }
      // bbox is a rectangle; keep only stations truly within `distance` miles.
      const within = (radiusData.data ?? []).filter(s => {
        const ll = s.meta?.ll
        return ll ? haversineMiles(lat, lon, ll[1], ll[0]) <= distance : false
      })
      const radiusBest = pickQualifiedStation(within)
      if (radiusBest) {
        const curIdx = best ? best.q.latestValidIdx : -2
        if (radiusBest.q.latestValidIdx > curIdx) best = radiusBest
        if (trailingGap(best) <= STALE_TRAILING_DAYS) break
      }
    }
  }

  if (best == null) return null
  const uid = best.stn.meta?.uid
  if (uid == null) return null

  const ll = best.stn.meta?.ll
  const distanceMiles = lat != null && lon != null && ll
    ? Math.round(haversineMiles(lat, lon, ll[1], ll[0]))
    : 0

  // Dated daily actual + normal for the chosen station.
  const stnRes = await fetch(`${ACIS_BASE}/StnData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, sdate, edate, elems, output: 'json' }),
    next: { revalidate: REVALIDATE },
  })
  if (!stnRes.ok) return null
  const stnData = await stnRes.json() as { meta?: { name?: string }; data?: Array<[string, string, string]> }
  const rows = stnData.data ?? []
  if (rows.length === 0) return null
  const name = stnData.meta?.name ?? best.stn.meta?.name ?? 'Unknown Station'
  return { name, distanceMiles, rows }
}

// ─── PRISM grid actual at the county centroid ─────────────────────────────────

async function fetchGridActual(
  lat: number,
  lon: number,
  sdate: string,
  edate: string,
): Promise<Array<{ date: string; actual: number | null }> | null> {
  const res = await fetch(`${ACIS_BASE}/GridData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loc: `${lon},${lat}`,
      grid: PRISM_GRID,
      sdate,
      edate,
      elems: [{ name: 'pcpn', interval: 'dly' }],
      output: 'json',
    }),
    next: { revalidate: REVALIDATE },
  })
  if (!res.ok) return null
  const j = await res.json() as { data?: Array<[string, number | string]> }
  const rows = j.data ?? []
  if (rows.length === 0) return null
  return rows.map(([date, v]) => ({ date, actual: parseGridValue(v) }))
}

// ─── Cumulative series builder ────────────────────────────────────────────────
//
// Accumulates actual (from `actualSeries`) and normal (climatology, by date)
// through the window, trims trailing days with no actual, and stops the normal at
// the last valid actual so the deficit can't be inflated by a station/grid that
// stopped reporting. Returns null if no actual exists or the normal is zero.

function buildSeries(
  actualSeries: Array<{ date: string; actual: number | null }>,
  normalByDate: Map<string, number | null>,
  source: 'grid' | 'station',
  label: string,
  distanceMiles: number,
): Omit<PrecipNormalData, 'gauge'> | null {
  let dailyData: DailyCumulative[] = []
  let actualCum = 0
  let normalCum = 0
  let lastValidIdx = -1

  for (let i = 0; i < actualSeries.length; i++) {
    const { date, actual } = actualSeries[i]
    const normal = normalByDate.get(date) ?? null
    if (actual !== null) { actualCum += actual; lastValidIdx = i }
    if (normal !== null) normalCum += normal
    dailyData.push({ date, actualCumulative: actualCum, normalCumulative: normalCum })
  }

  if (dailyData.length === 0 || lastValidIdx === -1) return null

  let dataThrough: string | null = null
  if (lastValidIdx < actualSeries.length - 1) {
    dailyData = dailyData.slice(0, lastValidIdx + 1)
    dataThrough = dailyData[lastValidIdx].date
  }

  const last = dailyData[dailyData.length - 1]
  const ytdActual = last.actualCumulative
  const ytdNormal = last.normalCumulative
  if (ytdNormal === 0) return null  // no usable normal — never render a deficit against zero

  const deficit = ytdActual - ytdNormal
  const deficitPct = (deficit / ytdNormal) * 100
  return { source, label, distanceMiles, dailyData, ytdActual, ytdNormal, deficit, deficitPct, dataThrough }
}

function toGauge(series: Omit<PrecipNormalData, 'gauge'>, name: string): GaugeReadout {
  return {
    name,
    distanceMiles: series.distanceMiles,
    through: series.dataThrough,
    ytdActual: series.ytdActual,
    ytdNormal: series.ytdNormal,
    deficit: series.deficit,
    deficitPct: series.deficitPct,
  }
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────
//
// Failsafe order:
//   1. PRISM grid county estimate (actual) + nearest qualifying station's normal
//      climatology  — primary; whole-county, no station outages, current.
//   2. Freshest qualifying station (actual + normal)  — labeled gauge fallback.
//   3. 'no_qualifying_station'  — only if neither a grid nor any station normal
//      exists in range (effectively unreachable once the grid is up).

export async function getPrecipNormal(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalResult> {
  const today = new Date()
  const edate = new Date(today)
  edate.setDate(today.getDate() - 4)   // ACIS reporting lag

  const year = today.getFullYear()
  const sdate = `${year}-01-01`
  const edateStr = edate.toISOString().slice(0, 10)

  try {
    // Run grid (primary actual) and station selection (normal source + gauge) together.
    const [gridActual, station] = await Promise.all([
      lat != null && lon != null ? fetchGridActual(lat, lon, sdate, edateStr) : Promise.resolve(null),
      selectStation(fips, lat, lon, sdate, edateStr),
    ])

    // Station series (actual + its own normal) — the gauge readout and fallback.
    let stationSeries: Omit<PrecipNormalData, 'gauge'> | null = null
    let stationNormalByDate: Map<string, number | null> | null = null
    if (station) {
      stationNormalByDate = new Map(station.rows.map(r => [r[0], parseValue(r[2])]))
      const stationActual = station.rows.map(r => ({ date: r[0], actual: parseValue(r[1]) }))
      stationSeries = buildSeries(stationActual, stationNormalByDate, 'station', station.name, station.distanceMiles)
    }

    // 1. PRIMARY — PRISM grid actual + station normal climatology.
    if (gridActual && stationNormalByDate) {
      const gridSeries = buildSeries(gridActual, stationNormalByDate, 'grid', 'PRISM county estimate', 0)
      if (gridSeries) {
        const gauge = stationSeries && station ? toGauge(stationSeries, station.name) : null
        return { ...gridSeries, gauge }
      }
    }

    // 2. FALLBACK — the gauge itself becomes the primary series.
    if (stationSeries) return { ...stationSeries, gauge: null }

    // 3. Nothing usable.
    return 'no_qualifying_station'
  } catch {
    return null
  }
}

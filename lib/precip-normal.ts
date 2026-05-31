import 'server-only'

const ACIS_BASE = 'https://data.rcc-acis.org'
const PRISM_GRID = '21'          // ACIS grid 21 = PRISM daily precip — whole-county, no station outages
const REVALIDATE = 86400         // 24h Data Cache

// Coverage floor: a station must have valid actual readings for ≥50% of the YTD
// window to be a usable gauge. Below half a year of daily reports the cumulative
// under-counts and reads as a fake deficit.
const COVERAGE_FLOOR = 0.5

// Currency: a station is "current" only if its most recent valid reading is within
// this many days of today. ACIS lags ~4 days, so 10 days tolerates a few extra
// missed days but DEMOTES a station that went quiet weeks ago (e.g. one whose last
// reading is 3 weeks old) so the grid failsafe can keep the card current.
const CURRENT_MAX_AGE_DAYS = 10

export interface DailyCumulative {
  date: string
  actualCumulative: number
  normalCumulative: number
}

// Grid-failsafe context: the nearest full station, shown for provenance and used
// as the normal source when no current station exists.
export interface StationContext {
  name: string
  distanceMiles: number
  lastValid: string | null
}

export interface PrecipNormalData {
  source: 'station' | 'grid'   // station = authoritative gauge (primary); grid = PRISM failsafe
  label: string                // station name, or "PRISM county estimate"
  distanceMiles: number        // gauge distance from county center (0 in grid mode)
  dailyData: DailyCumulative[]
  ytdActual: number
  ytdNormal: number
  deficit: number
  deficitPct: number
  dataThrough: string | null   // last valid actual date (= series end)
  context: StationContext | null  // grid mode only: the station supplying the normal
}

// Result of a precip lookup:
//   PrecipNormalData       — usable series (station primary, or grid failsafe)
//   'no_qualifying_station'— no current station AND grid/normal unavailable
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

function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Bounding box (W,S,E,N) ~`miles` around a point — ACIS MultiStnData area specifier.
// NOTE: ACIS does NOT support `ll`+`distance` for stations (silently returns zero),
// so we use bbox and filter by true great-circle distance.
function bboxFor(lat: number, lon: number, miles: number): string {
  const dLat = miles / 69
  const dLon = miles / (69 * Math.cos((lat * Math.PI) / 180))
  return `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`
}

// ─── Candidate assessment ─────────────────────────────────────────────────────

interface Candidate {
  name: string
  uid: number
  distanceMiles: number
  actValid: number
  total: number
  hasNormals: boolean
  lastValid: string | null   // ISO date of most recent valid actual
  inCounty: boolean
}

function buildCandidates(
  stations: AcisStn[],
  lat: number | null,
  lon: number | null,
  sdate: string,
  inCounty: boolean,
): Candidate[] {
  const out: Candidate[] = []
  for (const s of stations) {
    const uid = s.meta?.uid
    if (uid == null) continue
    const rows = s.data ?? []
    let latestValidIdx = -1
    let actValid = 0
    let hasNormals = false
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]?.[0]
      const n = rows[i]?.[1]
      if (a !== 'M' && a != null) { actValid++; latestValidIdx = i }
      if (n !== 'M' && n != null) hasNormals = true
    }
    const ll = s.meta?.ll
    const distanceMiles = lat != null && lon != null && ll
      ? Math.round(haversineMiles(lat, lon, ll[1], ll[0]))
      : 0
    out.push({
      name: s.meta?.name ?? 'Unknown Station',
      uid,
      distanceMiles,
      actValid,
      total: rows.length,
      hasNormals,
      lastValid: latestValidIdx >= 0 ? addDaysISO(sdate, latestValidIdx) : null,
      inCounty,
    })
  }
  return out
}

// "Full/good": usable normals AND enough YTD coverage to trust the cumulative.
function isFull(c: Candidate): boolean {
  return c.hasNormals && c.total > 0 && c.actValid >= Math.floor(c.total * COVERAGE_FLOOR)
}

// "Current": most recent valid reading within CURRENT_MAX_AGE_DAYS of today.
function isCurrent(c: Candidate, today: number): boolean {
  if (!c.lastValid) return false
  const ageDays = (today - Date.parse(`${c.lastValid}T00:00:00Z`)) / 86_400_000
  return ageDays <= CURRENT_MAX_AGE_DAYS
}

// Nearest station that is full AND current — the authoritative gauge. Prefer
// in-county; otherwise nearest by great-circle distance.
function pickNearestCurrentFull(cands: Candidate[], today: number): Candidate | null {
  const ok = cands.filter(c => isFull(c) && isCurrent(c, today))
  if (ok.length === 0) return null
  const inCounty = ok.filter(c => c.inCounty)
  const pool = inCounty.length ? inCounty : ok
  return pool.sort((a, b) => a.distanceMiles - b.distanceMiles)[0]
}

// Nearest full station regardless of currency — supplies the normal climatology
// (and provenance) for the grid failsafe. Prefer in-county.
function pickNearestFull(cands: Candidate[]): Candidate | null {
  const ok = cands.filter(isFull)
  if (ok.length === 0) return null
  const inCounty = ok.filter(c => c.inCounty)
  const pool = inCounty.length ? inCounty : ok
  return pool.sort((a, b) => a.distanceMiles - b.distanceMiles)[0]
}

// ─── ACIS fetch helpers ───────────────────────────────────────────────────────

const ELEMS = [{ name: 'pcpn' }, { name: 'pcpn', normal: '1' }]

async function fetchMultiStn(body: Record<string, unknown>): Promise<AcisStn[]> {
  const res = await fetch(`${ACIS_BASE}/MultiStnData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, meta: ['uid', 'name', 'll'], elems: ELEMS, output: 'json' }),
    next: { revalidate: REVALIDATE },
  })
  if (!res.ok) return []
  const json = await res.json() as { data?: AcisStn[] }
  return json.data ?? []
}

// Dated daily [date, actual, normal] for one station.
async function fetchStnRows(uid: number, sdate: string, edate: string): Promise<Array<[string, string, string]> | null> {
  const res = await fetch(`${ACIS_BASE}/StnData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, sdate, edate, elems: ELEMS, output: 'json' }),
    next: { revalidate: REVALIDATE },
  })
  if (!res.ok) return null
  const json = await res.json() as { data?: Array<[string, string, string]> }
  const rows = json.data ?? []
  return rows.length ? rows : null
}

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
// Accumulates actual + normal through the window, trims trailing days with no
// actual, and stops the normal at the last valid actual so the deficit can't be
// inflated by a source that stopped reporting. Returns null if no actual exists
// or the normal is zero.

function buildSeries(
  actualSeries: Array<{ date: string; actual: number | null }>,
  normalByDate: Map<string, number | null>,
  source: 'station' | 'grid',
  label: string,
  distanceMiles: number,
): Omit<PrecipNormalData, 'context'> | null {
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
  if (lastValidIdx < actualSeries.length - 1) dailyData = dailyData.slice(0, lastValidIdx + 1)

  const last = dailyData[dailyData.length - 1]
  const ytdActual = last.actualCumulative
  const ytdNormal = last.normalCumulative
  if (ytdNormal === 0) return null  // never render a deficit against a zero normal

  const deficit = ytdActual - ytdNormal
  const deficitPct = (deficit / ytdNormal) * 100
  return { source, label, distanceMiles, dailyData, ytdActual, ytdNormal, deficit, deficitPct, dataThrough: last.date }
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────
//
// Priority:
//   1. PRIMARY (authoritative) — nearest NOAA station that is full (coverage +
//      normals) AND current (reported within CURRENT_MAX_AGE_DAYS). Uses its OWN
//      actual and OWN normal — location-consistent, never stitched, never
//      overridden by the grid.
//   2. FAILSAFE — only if no current full station exists: PRISM grid actual at the
//      county centroid + the nearest full station's normal, labeled as a modeled
//      estimate, with the gauge's last-valid date for context.
//   3. 'no_qualifying_station' — only if even the grid fails (effectively unreachable).

export async function getPrecipNormal(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalResult> {
  const today = new Date()
  const edate = new Date(today)
  edate.setDate(today.getDate() - 4)   // ACIS reporting lag

  const sdate = `${today.getFullYear()}-01-01`
  const edateStr = edate.toISOString().slice(0, 10)
  const nowMs = Date.now()

  try {
    // Gather candidates: in-county first.
    let cands = buildCandidates(await fetchMultiStn({ county: fips }), lat, lon, sdate, true)
    let primary = pickNearestCurrentFull(cands, nowMs)

    // No current full station in-county → expand by bbox (50 → 100 → 150 mi),
    // accumulating candidates, until a current full station appears.
    if (primary == null && lat != null && lon != null) {
      const seen = new Set(cands.map(c => c.uid))
      for (const distance of [50, 100, 150]) {
        const ring = buildCandidates(await fetchMultiStn({ bbox: bboxFor(lat, lon, distance) }), lat, lon, sdate, false)
          .filter(c => c.distanceMiles <= distance && !seen.has(c.uid))
        for (const c of ring) seen.add(c.uid)
        cands = cands.concat(ring)
        primary = pickNearestCurrentFull(cands, nowMs)
        if (primary) break
      }
    }

    // 1. PRIMARY — the current full station, its own actual + own normal.
    if (primary) {
      const rows = await fetchStnRows(primary.uid, sdate, edateStr)
      if (rows) {
        const actual = rows.map(r => ({ date: r[0], actual: parseValue(r[1]) }))
        const normalByDate = new Map(rows.map(r => [r[0], parseValue(r[2])]))
        const series = buildSeries(actual, normalByDate, 'station', primary.name, primary.distanceMiles)
        if (series) return { ...series, context: null }
      }
    }

    // 2. FAILSAFE — PRISM grid actual + nearest full station's normal climatology.
    if (lat != null && lon != null) {
      const normalStn = pickNearestFull(cands)
      if (normalStn) {
        const [gridActual, normRows] = await Promise.all([
          fetchGridActual(lat, lon, sdate, edateStr),
          fetchStnRows(normalStn.uid, sdate, edateStr),
        ])
        if (gridActual && normRows) {
          const normalByDate = new Map(normRows.map(r => [r[0], parseValue(r[2])]))
          const series = buildSeries(gridActual, normalByDate, 'grid', 'PRISM county estimate', 0)
          if (series) {
            return {
              ...series,
              context: { name: normalStn.name, distanceMiles: normalStn.distanceMiles, lastValid: normalStn.lastValid },
            }
          }
        }
      }
    }

    // 3. Nothing usable.
    return 'no_qualifying_station'
  } catch {
    return null
  }
}

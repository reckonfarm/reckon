import 'server-only'
import { unstable_cache } from 'next/cache'

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

// Freshness supersede: when the chosen primary station's most recent reading lags the
// window end by MORE than this many days, we check the PRISM grid. If the grid (a
// gap-free, whole-county series) is at least this many days FRESHER than the station,
// we render the grid estimate instead — so the card isn't needlessly frozen behind a
// gauge that simply stopped reporting. A station within this tolerance of the window
// end stays primary and the grid call is never made (fast path). This does NOT change
// station currency (CURRENT_MAX_AGE_DAYS): a lagging station is still valid, just
// superseded when a materially fresher county source exists, with provenance flipped
// visibly to "PRISM county estimate".
const STATION_LAG_TOLERANCE_DAYS = 2

// Distance cap for accepting an OUT-OF-COUNTY station as the PRIMARY gauge. An
// in-county station is representative at any distance (no cap); an out-of-county
// gauge is trusted only within this radius. Past it, a real gauge is no longer
// representative of the county, so the in-county PRISM grid failsafe is the better
// read and takes over. NOTE: the bbox search may still reach 150 mi to SOURCE a
// normal for that grid failsafe — only primary-station ACCEPTANCE is capped here.
// Env-overridable.
const STATION_MAX_MILES = Number(process.env.PRECIP_STATION_MAX_MILES) || 100

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
  outOfCounty: boolean         // station mode only: true if the gauge is outside the county (≤STATION_MAX_MILES away)
}

// Result of a precip lookup:
//   PrecipNormalData        — usable series (station primary, or grid failsafe)
//   'no_qualifying_station' — ACIS responded successfully (200), but no station was
//                             full + current + with-normals, AND the grid failsafe
//                             produced no usable series. A genuine data-absence.
//   'data_unavailable'      — could NOT get a trustworthy answer from ACIS: a call
//                             returned non-2xx, threw, or was unparseable after
//                             retries. An AVAILABILITY failure, NOT data absence.
//   null                    — default / not-yet-fetched sentinel (no county selected)
export type PrecipNormalResult = PrecipNormalData | 'no_qualifying_station' | 'data_unavailable' | null

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

// Whole-day difference bIso − aIso (both ISO yyyy-mm-dd). Positive when b is later.
function daysBetweenISO(aIso: string, bIso: string): number {
  return (Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 86_400_000
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

// Nearest station that is full AND current — the authoritative gauge. Hierarchy:
//   1. nearest IN-COUNTY full+current station (any distance — always representative)
//   2. else nearest OUT-OF-COUNTY full+current station, but ONLY within
//      STATION_MAX_MILES; past that the grid failsafe is the better read.
function pickNearestCurrentFull(cands: Candidate[], today: number): Candidate | null {
  const ok = cands.filter(c => isFull(c) && isCurrent(c, today))
  if (ok.length === 0) return null
  const inCounty = ok.filter(c => c.inCounty)
  if (inCounty.length) return inCounty.sort((a, b) => a.distanceMiles - b.distanceMiles)[0]
  const nearbyOut = ok.filter(c => c.distanceMiles <= STATION_MAX_MILES)
  if (nearbyOut.length === 0) return null
  return nearbyOut.sort((a, b) => a.distanceMiles - b.distanceMiles)[0]
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

// Descriptive UA: ACIS publishes no UA requirement, but UA-less requests from
// datacenter IPs (Vercel's egress) are a common block trigger — cheap insurance.
const ACIS_UA = 'Dryline/1.0 (+reckonfarm.com)'
const ACIS_MAX_RETRIES = 2   // initial attempt + up to 2 retries on failure
const ACIS_FETCH_TIMEOUT_MS = 8000   // per ACIS HTTP call — hung host rejects, not hangs
const PRECIP_DEADLINE_MS    = 9000   // overall cap; past this → honest 'data_unavailable'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Low-level ACIS POST with UA header, retry-on-failure, and status logging.
// Returns a discriminated outcome so callers can tell an AVAILABILITY failure
// (non-2xx, thrown, or unparseable — even after retries) apart from a successful
// response that simply carried no data. NOTE: POST requests are NOT cached by
// Next's Data Cache, so retries here always re-hit ACIS (no memoized failure).
async function acisPost(
  endpoint: string,
  body: Record<string, unknown>,
  callType: string,
  fips: string,
): Promise<{ ok: true; json: unknown } | { ok: false }> {
  let lastStatus: number | string = 'no-response'
  for (let attempt = 0; attempt <= ACIS_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${ACIS_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': ACIS_UA },
        body: JSON.stringify(body),
        next: { revalidate: REVALIDATE },
        // Per-call hard timeout — a hung ACIS host rejects (caught below as a
        // failure) instead of blocking forever. The overall path is additionally
        // capped by PRECIP_DEADLINE_MS in getPrecipNormal.
        signal: AbortSignal.timeout(ACIS_FETCH_TIMEOUT_MS),
      })
      lastStatus = res.status
      if (res.ok) {
        try {
          return { ok: true, json: await res.json() }
        } catch {
          lastStatus = `${res.status} (unparseable body)`
        }
      }
    } catch (e) {
      lastStatus = e instanceof Error ? `threw: ${e.message}` : 'threw'
    }
    if (attempt < ACIS_MAX_RETRIES) await sleep(300 * (attempt + 1))  // 300ms, then 600ms
  }
  // Decisive evidence for the real availability fix: what ACIS actually returned.
  console.error(`[precip] ACIS ${endpoint} (${callType}) failed after retries: status=${lastStatus} fips=${fips}`)
  return { ok: false }
}

type MultiStnOutcome = { ok: true; stations: AcisStn[] } | { ok: false }

// `area` is the spatial selector ({ county } or { bbox }). The date window is
// REQUIRED by ACIS — MultiStnData 400s with "Need date range" without it — so we
// thread the same sdate/edate the StnData/GridData calls use.
async function fetchMultiStn(
  area: Record<string, unknown>,
  sdate: string,
  edate: string,
  callType: string,
  fips: string,
): Promise<MultiStnOutcome> {
  const r = await acisPost('MultiStnData', { ...area, sdate, edate, meta: ['uid', 'name', 'll'], elems: ELEMS, output: 'json' }, callType, fips)
  if (!r.ok) return { ok: false }
  const stations = (r.json as { data?: AcisStn[] }).data ?? []
  if (stations.length === 0) console.error(`[precip] ACIS MultiStnData (${callType}) returned empty 200 fips=${fips}`)
  return { ok: true, stations }
}

type StnRowsOutcome = { ok: true; rows: Array<[string, string, string]> | null } | { ok: false }

// Dated daily [date, actual, normal] for one station.
async function fetchStnRows(uid: number, sdate: string, edate: string, fips: string): Promise<StnRowsOutcome> {
  const r = await acisPost('StnData', { uid, sdate, edate, elems: ELEMS, output: 'json' }, `StnData uid=${uid}`, fips)
  if (!r.ok) return { ok: false }
  const rows = (r.json as { data?: Array<[string, string, string]> }).data ?? []
  return { ok: true, rows: rows.length ? rows : null }
}

type GridOutcome = { ok: true; rows: Array<{ date: string; actual: number | null }> | null } | { ok: false }

async function fetchGridActual(lat: number, lon: number, sdate: string, edate: string, fips: string): Promise<GridOutcome> {
  const r = await acisPost('GridData', {
    loc: `${lon},${lat}`,
    grid: PRISM_GRID,
    sdate,
    edate,
    elems: [{ name: 'pcpn', interval: 'dly' }],
    output: 'json',
  }, 'GridData', fips)
  if (!r.ok) return { ok: false }
  const rows = (r.json as { data?: Array<[string, number | string]> }).data ?? []
  if (rows.length === 0) return { ok: true, rows: null }
  return { ok: true, rows: rows.map(([date, v]) => ({ date, actual: parseGridValue(v) })) }
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
): Omit<PrecipNormalData, 'context' | 'outOfCounty'> | null {
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

// PRISM grid failsafe series: county-centroid grid actual (gap-free, immune to station
// outages) paired with the nearest full station's NORMAL climatology. The grid carries
// no normal, so the normal is always station-sourced — and a station's normals exist for
// every date even when its actuals have stopped, so a lagging gauge can still supply the
// climatology for fresh grid actuals. Returns the labeled grid result, or { failed: true }
// when an ACIS call failed (availability, not absence), or null when no normal-source
// station / no usable series exists.
async function buildGridFailsafe(
  cands: Candidate[],
  lat: number,
  lon: number,
  sdate: string,
  edateStr: string,
  fips: string,
): Promise<{ data: PrecipNormalData } | { failed: true } | null> {
  const normalStn = pickNearestFull(cands)
  if (!normalStn) return null
  const [gridRes, normRes] = await Promise.all([
    fetchGridActual(lat, lon, sdate, edateStr, fips),
    fetchStnRows(normalStn.uid, sdate, edateStr, fips),
  ])
  if (!gridRes.ok || !normRes.ok) return { failed: true }
  if (!gridRes.rows || !normRes.rows) return null
  const normalByDate = new Map(normRes.rows.map(r => [r[0], parseValue(r[2])]))
  const series = buildSeries(gridRes.rows, normalByDate, 'grid', 'PRISM county estimate', 0)
  if (!series) return null
  return {
    data: {
      ...series,
      context: { name: normalStn.name, distanceMiles: normalStn.distanceMiles, lastValid: normalStn.lastValid },
      outOfCounty: false,
    },
  }
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
//   3. 'no_qualifying_station' — ACIS answered (200) but produced no usable series.
//   4. 'data_unavailable' — an ACIS call failed (non-2xx/threw/unparseable). We must
//      NEVER report this as "no qualifying station": it's an availability failure,
//      not data absence.

// Overall cap: if the ACIS path (multiple sequential calls + retries) exceeds
// PRECIP_DEADLINE_MS — e.g. a hung host — resolve to 'data_unavailable' so the rain
// chart shows an HONEST "temporarily unavailable" rather than blocking the dashboard
// render. NEVER resolves to a data series or a zero/empty (which would read as a
// false deficit); the timeout branch is the availability-failure state.
// Live (uncached) precip lookup — the ACIS orchestration + overall deadline.
async function getPrecipNormalLive(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalResult> {
  return Promise.race([
    computePrecipNormal(fips, lat, lon),
    new Promise<PrecipNormalResult>(resolve =>
      setTimeout(() => resolve('data_unavailable'), PRECIP_DEADLINE_MS)),
  ])
}

// 24h server cache. ACIS POSTs are NOT cacheable by Next's fetch Data Cache, so we
// memoize the FINAL result via unstable_cache, keyed by fips/lat/lon + the calendar
// day (a new day re-fetches). CRITICAL honest-failure rule: 'data_unavailable' is an
// AVAILABILITY failure — we THROW so unstable_cache never caches it (a transient ACIS
// outage must not stick for 24h); the public wrapper turns it back into an honest
// 'data_unavailable'. Genuine outcomes (a real series, or 'no_qualifying_station') ARE
// cached — never a fabricated or zeroed value.
const getPrecipNormalCached = unstable_cache(
  async (
    fips: string,
    lat: number | null,
    lon: number | null,
    _dayKey: string,
  ): Promise<PrecipNormalResult> => {
    const result = await getPrecipNormalLive(fips, lat, lon)
    if (result === 'data_unavailable') throw new Error('precip-unavailable: not cacheable')
    return result
  },
  ['precip-normal'],
  { revalidate: REVALIDATE },
)

export async function getPrecipNormal(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalResult> {
  const dayKey = new Date().toISOString().slice(0, 10)
  try {
    return await getPrecipNormalCached(fips, lat, lon, dayKey)
  } catch {
    // Availability failure (thrown above) → honest 'data_unavailable', never cached.
    return 'data_unavailable'
  }
}

async function computePrecipNormal(
  fips: string,
  lat: number | null,
  lon: number | null,
): Promise<PrecipNormalResult> {
  const today = new Date()
  const edate = new Date(today)
  // ACIS station reporting lag. today−2 surfaces recent rain ~2 days sooner than
  // the old today−4. Verified against live Montana stations that coverage at −2 is
  // solid: the nearest-station pick + trailing-trim in buildSeries only ever charts
  // a station's TRUE last reading, so days a station hasn't reported yet are simply
  // not shown — they never inflate a false deficit. Do not push past −2 (the last
  // day or two has thin station coverage; the buffer protects accuracy).
  edate.setDate(today.getDate() - 2)

  const sdate = `${today.getFullYear()}-01-01`
  const edateStr = edate.toISOString().slice(0, 10)
  const nowMs = Date.now()

  // Tracks whether ANY ACIS call failed to return a usable response (after
  // retries). If we end with no series AND this is set, we return
  // 'data_unavailable' rather than falsely claiming no station exists.
  let availabilityFailure = false

  try {
    // Gather candidates: in-county first.
    const countyRes = await fetchMultiStn({ county: fips }, sdate, edateStr, 'county', fips)
    if (!countyRes.ok) availabilityFailure = true
    let cands = buildCandidates(countyRes.ok ? countyRes.stations : [], lat, lon, sdate, true)
    let primary = pickNearestCurrentFull(cands, nowMs)

    // No current full station in-county → expand by bbox (50 → 100 → 150 mi),
    // accumulating candidates, until a current full station appears.
    if (primary == null && lat != null && lon != null) {
      const seen = new Set(cands.map(c => c.uid))
      for (const distance of [50, 100, 150]) {
        const ringRes = await fetchMultiStn({ bbox: bboxFor(lat, lon, distance) }, sdate, edateStr, `bbox ${distance}mi`, fips)
        if (!ringRes.ok) { availabilityFailure = true; continue }
        const ring = buildCandidates(ringRes.stations, lat, lon, sdate, false)
          .filter(c => c.distanceMiles <= distance && !seen.has(c.uid))
        for (const c of ring) seen.add(c.uid)
        cands = cands.concat(ring)
        primary = pickNearestCurrentFull(cands, nowMs)
        if (primary) break
      }
    }

    // 1. PRIMARY — the current full station, its own actual + own normal.
    if (primary) {
      const rowsRes = await fetchStnRows(primary.uid, sdate, edateStr, fips)
      if (!rowsRes.ok) availabilityFailure = true
      else if (rowsRes.rows) {
        const actual = rowsRes.rows.map(r => ({ date: r[0], actual: parseValue(r[1]) }))
        const normalByDate = new Map(rowsRes.rows.map(r => [r[0], parseValue(r[2])]))
        const series = buildSeries(actual, normalByDate, 'station', primary.name, primary.distanceMiles)
        if (series) {
          const stationResult: PrecipNormalData = { ...series, context: null, outOfCounty: !primary.inCounty }
          // Freshness supersede: if this gauge's last real reading lags the window end
          // by more than the tolerance, check whether the PRISM grid has a materially
          // fresher whole-county series. Only a lagging station pays for the extra grid
          // call; a current station returns immediately (fast path, unchanged behavior).
          const stationThrough = stationResult.dataThrough
          if (
            stationThrough &&
            lat != null && lon != null &&
            daysBetweenISO(stationThrough, edateStr) > STATION_LAG_TOLERANCE_DAYS
          ) {
            const grid = await buildGridFailsafe(cands, lat, lon, sdate, edateStr, fips)
            if (
              grid && 'data' in grid && grid.data.dataThrough &&
              daysBetweenISO(stationThrough, grid.data.dataThrough) >= STATION_LAG_TOLERANCE_DAYS
            ) {
              // Grid is ≥ tolerance days newer → present the honest county estimate
              // ('grid' source + "PRISM county estimate" label). Provenance flips
              // visibly; we never relabel a modeled estimate as the gauge. A grid
              // outage or a not-fresher grid falls through to the real gauge reading
              // below (still valid, just stale) — never a downgrade to unavailable.
              return grid.data
            }
          }
          return stationResult
        }
      }
    }

    // 2. FAILSAFE — PRISM grid actual + nearest full station's normal climatology,
    //    used when no current full station exists at all.
    if (lat != null && lon != null) {
      const grid = await buildGridFailsafe(cands, lat, lon, sdate, edateStr, fips)
      if (grid) {
        if ('failed' in grid) availabilityFailure = true
        else return grid.data
      }
    }

    // 3. Nothing usable — distinguish an ACIS availability failure from a genuine
    //    "ACIS answered but no qualifying station" result.
    return availabilityFailure ? 'data_unavailable' : 'no_qualifying_station'
  } catch (e) {
    console.error(`[precip] getPrecipNormal threw fips=${fips}:`, e instanceof Error ? e.message : e)
    return 'data_unavailable'
  }
}

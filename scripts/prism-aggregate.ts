// ─── PRISM zonal aggregation → percent-of-normal per county (Phase A step 3) ─────
//
// Runs OFF Vercel — a sibling step in the prism-ingest GitHub Actions job, AFTER the
// ingest step. Reads the clipped PRISM grids already in public.prism_grid_raw and the
// bundled county geometry (public/geo/np-counties.geojson), and for each of the 291
// Northern Plains counties computes ONE growing-season precip percent-of-normal,
// upserting into public.hay_score_inputs.
//
// Method (validated against Petroleum MT 30069 ≈ 83%, Lancaster NE 31109 ≈ 72%,
// Custer SD 46033 ≈ 86%):
//   • grid→county: POINT-IN-POLYGON on grid cell CENTERS (bbox-prefiltered per county).
//   • per county, per month: mean of in-county cells, NODATA (−9999) EXCLUDED, never 0-filled.
//   • season: SUM the 3 monthly county-means (Apr+May+Jun), THEN ratio — not the avg of
//     monthly ratios. pct = actual_sum / normal_sum × 100.
//   • no usable cells (cells_used=0) or normal_sum=0 → NULL, never 0 / never a fake percent.
//
// NOTHING reads hay_score_inputs yet — no score (Commit 4), no map/render change.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SEASON_MONTHS = [4, 5, 6] // Apr–Jun
const SEASON_LABEL = 'Apr–Jun'
const ELEMENT = 'ppt'
const SENTINELS = new Set(['30069', '31109', '46033']) // logged for verification
const SOURCE = 'PRISM 4km monthly ppt + 1991-2020 normals'

const pad2 = (n: number) => String(n).padStart(2, '0')

function lastCompleteSeasonYear(): number {
  const now = new Date()
  return now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

// ── Geometry types (np-counties.geojson) ────────────────────────────────────────
type Ring = number[][]
type PolyCoords = Ring[] // [outer, ...holes]
type Geom =
  | { type: 'Polygon'; coordinates: PolyCoords }
  | { type: 'MultiPolygon'; coordinates: PolyCoords[] }
interface CountyFeature { properties: { GEOID: string; NAME: string; STATEFP: string }; geometry: Geom }
interface CountyFC { features: CountyFeature[] }

function polysOf(f: CountyFeature): PolyCoords[] {
  return f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
}

// Ray-cast point-in-polygon over a feature's outer rings (county holes are negligible).
function pointInFeature(lon: number, lat: number, f: CountyFeature): boolean {
  let inside = false
  for (const poly of polysOf(f)) {
    const ring = poly[0]
    let c = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c
    }
    if (c) inside = !inside
  }
  return inside
}

function bboxOf(f: CountyFeature): [number, number, number, number] {
  let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity
  for (const poly of polysOf(f)) for (const [x, y] of poly[0]) {
    if (x < lon0) lon0 = x; if (x > lon1) lon1 = x
    if (y < lat0) lat0 = y; if (y > lat1) lat1 = y
  }
  return [lon0, lon1, lat0, lat1]
}

// ── Clipped grid (one prism_grid_raw row) ────────────────────────────────────────
interface Grid {
  ncols: number; nrows: number
  xllcorner: number; yllcorner: number; cellsize: number; nodata: number
  cells: number[][] // nrows × ncols, row 0 = north
}

function sameGeometry(a: Grid, b: Grid): boolean {
  return a.ncols === b.ncols && a.nrows === b.nrows &&
    a.xllcorner === b.xllcorner && a.yllcorner === b.yllcorner &&
    a.cellsize === b.cellsize && a.nodata === b.nodata
}

// Cell-center coordinates for the stored clip (lower-left corner origin, row 0 = north).
const lonCenter = (g: Grid, c: number) => g.xllcorner + (c + 0.5) * g.cellsize
const latCenter = (g: Grid, r: number) => g.yllcorner + (g.nrows - 1 - r + 0.5) * g.cellsize

// The in-county cell index list — computed ONCE per county from the shared grid geometry
// (all 6 grids are identical clips). bbox-prefiltered so we only PIP-test nearby cells.
function inCountyCells(g: Grid, f: CountyFeature): Array<[number, number]> {
  const [lon0, lon1, lat0, lat1] = bboxOf(f)
  const cMin = Math.max(0, Math.floor((lon0 - g.xllcorner) / g.cellsize) - 1)
  const cMax = Math.min(g.ncols - 1, Math.ceil((lon1 - g.xllcorner) / g.cellsize) + 1)
  const rowFromLat = (lat: number) => (g.nrows - 0.5) - (lat - g.yllcorner) / g.cellsize
  const rMin = Math.max(0, Math.floor(rowFromLat(lat1)) - 1) // lat1 (north) → smaller row
  const rMax = Math.min(g.nrows - 1, Math.ceil(rowFromLat(lat0)) + 1)
  const out: Array<[number, number]> = []
  for (let r = rMin; r <= rMax; r++) {
    const lat = latCenter(g, r)
    for (let c = cMin; c <= cMax; c++) {
      if (pointInFeature(lonCenter(g, c), lat, f)) out.push([r, c])
    }
  }
  return out
}

// Mean over the given cells, NODATA excluded (never zero-filled). null if none real.
function meanAt(g: Grid, idx: Array<[number, number]>): number | null {
  let sum = 0, n = 0
  for (const [r, c] of idx) {
    const v = g.cells[r][c]
    if (v !== g.nodata) { sum += v; n++ }
  }
  return n ? sum / n : null
}

async function loadGrid(db: SupabaseClient, periodType: string, period: string): Promise<Grid | null> {
  const { data, error } = await db
    .from('prism_grid_raw')
    .select('ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value, cells')
    .eq('element', ELEMENT).eq('period_type', periodType).eq('period', period)
    .maybeSingle()
  if (error) throw new Error(`read prism_grid_raw ${periodType}/${period}: ${error.message}`)
  if (!data) return null
  return {
    ncols: data.ncols, nrows: data.nrows,
    xllcorner: data.xllcorner, yllcorner: data.yllcorner,
    cellsize: data.cellsize, nodata: data.nodata_value,
    cells: data.cells as number[][],
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in prism-aggregate') } }
  const db: SupabaseClient = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  const seasonYear = lastCompleteSeasonYear()
  console.log(`[prism-aggregate] season=${seasonYear} ${SEASON_LABEL}`)

  // Load the 6 grids; abort (no partial writes) if any is missing.
  const actuals: Grid[] = [], normals: Grid[] = []
  for (const mm of SEASON_MONTHS) {
    const a = await loadGrid(db, 'monthly', `${seasonYear}${pad2(mm)}`)
    const n = await loadGrid(db, 'normal_monthly', pad2(mm))
    if (!a) { console.error(`[prism-aggregate] missing actual grid ${seasonYear}${pad2(mm)} — aborting`); process.exit(1) }
    if (!n) { console.error(`[prism-aggregate] missing normal grid ${pad2(mm)} — aborting`); process.exit(1) }
    actuals.push(a); normals.push(n)
  }
  const allGrids = [...actuals, ...normals]
  if (!allGrids.every(g => sameGeometry(g, allGrids[0]))) {
    console.error('[prism-aggregate] grids do not share geometry — aborting'); process.exit(1)
  }
  const geom = allGrids[0]

  const fc = JSON.parse(
    readFileSync(join(process.cwd(), 'public/geo/np-counties.geojson'), 'utf8'),
  ) as CountyFC
  console.log(`[prism-aggregate] ${fc.features.length} counties · grid ${geom.ncols}×${geom.nrows}`)

  interface Row {
    fips: string; county_name: string; state_fips: string
    season_year: number; season_label: string
    actual_sum_mm: number | null; normal_sum_mm: number | null
    pct_of_normal: number | null; cells_used: number; source: string
  }
  const rows: Row[] = []
  let nullCount = 0

  for (const f of fc.features) {
    const idx = inCountyCells(geom, f) // shared geometry → one index list for all 6 grids
    const cellsUsed = idx.length

    let actualSum: number | null = null
    let normalSum: number | null = null
    if (cellsUsed > 0) {
      let aSum = 0, nSum = 0, ok = true
      for (let i = 0; i < SEASON_MONTHS.length; i++) {
        const am = meanAt(actuals[i], idx), nm = meanAt(normals[i], idx)
        if (am == null || nm == null) { ok = false; break }
        aSum += am; nSum += nm
      }
      if (ok) { actualSum = aSum; normalSum = nSum }
    }
    const pct = actualSum != null && normalSum != null && normalSum > 0
      ? (actualSum / normalSum) * 100
      : null
    if (pct == null) nullCount++

    const row: Row = {
      fips: f.properties.GEOID, county_name: f.properties.NAME, state_fips: f.properties.STATEFP,
      season_year: seasonYear, season_label: SEASON_LABEL,
      actual_sum_mm: actualSum, normal_sum_mm: normalSum, pct_of_normal: pct,
      cells_used: cellsUsed, source: SOURCE,
    }
    rows.push(row)
    if (SENTINELS.has(row.fips)) {
      console.log(
        `[prism-aggregate] ${row.fips} ${row.county_name}, ${row.state_fips}: ` +
        `actual=${actualSum?.toFixed(1) ?? '–'}mm normal=${normalSum?.toFixed(1) ?? '–'}mm ` +
        `pct=${pct != null ? Math.round(pct) + '%' : 'NULL'} cells=${cellsUsed}`,
      )
    }
  }

  const { error } = await db.from('hay_score_inputs').upsert(rows, { onConflict: 'fips' })
  if (error) { console.error('[prism-aggregate] upsert failed:', error.message); process.exit(1) }

  console.log(`[prism-aggregate] done — upserted ${rows.length} counties (${nullCount} NULL pct_of_normal)`)
  if (rows.length === 0) process.exit(1)
}

main().catch(err => { console.error('[prism-aggregate] threw:', err); process.exit(1) })

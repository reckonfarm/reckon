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

const SEASON_MONTHS = [2, 3, 4, 5, 6, 7] // Feb–Jul (rolling; only months present in prism_grid_raw are used)
const ELEMENT = 'ppt'
const SENTINELS = new Set(['30069', '31109', '46033']) // logged for verification
const SOURCE = 'PRISM 4km monthly ppt vs 1991-2020 normals · weighted Feb–Jul'

// Agronomic month weights (NDSU/MSU): Apr–Jun = the 80% growth engine, Feb–Mar = recharge
// (light), Jul = closeout. Applied as a WEIGHTED AVERAGE of monthly percent-of-normal, with
// the weights renormalized over whichever months actually exist (in-season). A deliberate,
// flagged shift from the old equal-weight sum-then-ratio: agronomic importance ≠ mm magnitude.
const MONTH_WEIGHT: Record<number, number> = { 2: 0.06, 3: 0.06, 4: 0.24, 5: 0.28, 6: 0.28, 7: 0.08 }
const MONTH_ABBR: Record<number, string> = { 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun', 7: 'Jul' }

const pad2 = (n: number) => String(n).padStart(2, '0')

const currentSeasonYear = (): number => new Date().getUTCFullYear()

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

async function loadGrid(db: SupabaseClient, periodType: string, period: string): Promise<(Grid & { isStable: boolean }) | null> {
  const { data, error } = await db
    .from('prism_grid_raw')
    .select('ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value, cells, is_stable')
    .eq('element', ELEMENT).eq('period_type', periodType).eq('period', period)
    .maybeSingle()
  if (error) throw new Error(`read prism_grid_raw ${periodType}/${period}: ${error.message}`)
  if (!data) return null
  return {
    ncols: data.ncols, nrows: data.nrows,
    xllcorner: data.xllcorner, yllcorner: data.yllcorner,
    cellsize: data.cellsize, nodata: data.nodata_value,
    cells: data.cells as number[][],
    isStable: data.is_stable as boolean,
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

  const seasonYear = currentSeasonYear()

  // MATCHED month-sets: keep only months where BOTH the actual AND its normal exist, so the
  // ratio is always Feb-to-date actual ÷ the SAME Feb-to-date normal — never partial ÷ full.
  // Months not yet released are simply absent (not zero-filled).
  const months: { mm: number; actual: Grid & { isStable: boolean }; normal: Grid }[] = []
  for (const mm of SEASON_MONTHS) {
    const a = await loadGrid(db, 'monthly', `${seasonYear}${pad2(mm)}`)
    const n = await loadGrid(db, 'normal_monthly', pad2(mm))
    if (a && n) months.push({ mm, actual: a, normal: n })
  }
  if (months.length === 0) {
    console.error(`[prism-aggregate] no matched ${seasonYear} Feb–Jul month grids found — aborting`); process.exit(1)
  }
  const allGrids = months.flatMap(m => [m.actual, m.normal])
  if (!allGrids.every(g => sameGeometry(g, allGrids[0]))) {
    console.error('[prism-aggregate] grids do not share geometry — aborting'); process.exit(1)
  }
  const geom = allGrids[0]

  // In-season provisional unless EVERY month used is PRISM-stable; the months actually covered.
  const isProvisional = !months.every(m => m.actual.isStable)
  const monthsUsed = months.map(m => pad2(m.mm))
  const seasonLabel = `Feb–${MONTH_ABBR[months[months.length - 1].mm]} ${seasonYear}`
  const weightSum = months.reduce((s, m) => s + MONTH_WEIGHT[m.mm], 0)
  console.log(`[prism-aggregate] ${seasonLabel} · months=${monthsUsed.join(',')} · provisional=${isProvisional} · grid ${geom.ncols}×${geom.nrows}`)

  const fc = JSON.parse(
    readFileSync(join(process.cwd(), 'public/geo/np-counties.geojson'), 'utf8'),
  ) as CountyFC

  interface Row {
    fips: string; county_name: string; state_fips: string
    season_year: number; season_label: string
    actual_sum_mm: number | null; normal_sum_mm: number | null
    pct_of_normal: number | null; cells_used: number
    is_provisional: boolean; months_used: string[]; source: string
  }
  const rows: Row[] = []
  let nullCount = 0

  for (const f of fc.features) {
    const idx = inCountyCells(geom, f) // shared geometry → one index list for all grids
    const cellsUsed = idx.length

    // Weighted average of monthly percent-of-normal, weights renormalized over the months
    // present (Σ MONTH_WEIGHT over `months`). Raw seasonal sums kept for reference/debug.
    let actualSum: number | null = null
    let normalSum: number | null = null
    let pct: number | null = null
    if (cellsUsed > 0) {
      let aSum = 0, nSum = 0, wRatio = 0, ok = true
      for (const m of months) {
        const am = meanAt(m.actual, idx), nm = meanAt(m.normal, idx)
        if (am == null || nm == null || nm <= 0) { ok = false; break }
        aSum += am; nSum += nm
        wRatio += MONTH_WEIGHT[m.mm] * (am / nm)
      }
      if (ok) { actualSum = aSum; normalSum = nSum; pct = (wRatio / weightSum) * 100 }
    }
    if (pct == null) nullCount++

    const row: Row = {
      fips: f.properties.GEOID, county_name: f.properties.NAME, state_fips: f.properties.STATEFP,
      season_year: seasonYear, season_label: seasonLabel,
      actual_sum_mm: actualSum, normal_sum_mm: normalSum, pct_of_normal: pct,
      cells_used: cellsUsed, is_provisional: isProvisional, months_used: monthsUsed, source: SOURCE,
    }
    rows.push(row)
    if (SENTINELS.has(row.fips)) {
      console.log(
        `[prism-aggregate] ${row.fips} ${row.county_name}, ${row.state_fips}: ` +
        `weighted pct=${pct != null ? Math.round(pct) + '%' : 'NULL'} cells=${cellsUsed} ` +
        `(raw Σactual=${actualSum?.toFixed(1) ?? '–'} Σnormal=${normalSum?.toFixed(1) ?? '–'})`,
      )
    }
  }

  const { error } = await db.from('hay_score_inputs').upsert(rows, { onConflict: 'fips' })
  if (error) { console.error('[prism-aggregate] upsert failed:', error.message); process.exit(1) }

  console.log(`[prism-aggregate] done — upserted ${rows.length} counties (${nullCount} NULL pct_of_normal) · ${seasonLabel} provisional=${isProvisional}`)
  if (rows.length === 0) process.exit(1)
}

main().catch(err => { console.error('[prism-aggregate] threw:', err); process.exit(1) })

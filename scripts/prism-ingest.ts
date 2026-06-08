// ─── PRISM precip ingest (Phase A step 2 — raw staging only) ─────────────────────
//
// Runs OFF Vercel (GitHub Actions, or locally for seeding). Fetches RAW PRISM monthly
// precip for the last complete Apr–Jun + the matching 1991–2020 monthly precip NORMALS
// from the consolidated web service, clips each grid to the 5-state Northern Plains
// bbox, stamps release date / stability, and UPSERTS the raw clipped grid into
// public.prism_grid_raw. Idempotent on the grid key; already-stored grids are SKIPPED
// (PRISM allows a file to be downloaded only twice per 24h — see DOWNLOAD LIMITS in
// the web-service docs).
//
// NOTHING reads prism_grid_raw yet. No aggregation, no score, no county join — those
// are later commits. This proves we can fetch PRISM and store it.
//
//   Local seed:  npx tsx scripts/prism-ingest.ts
//   CI:          same, with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
//
// PRISM contract (verified live, Oct-2025 consolidated service):
//   grid:    https://services.nacse.org/prism/data/get/<region>/<res>/<element>/<date>?format=bil
//   normal:  https://services.nacse.org/prism/data/get/normals/<region>/<res>/<element>/<MM>?format=bil
//   release: https://services.nacse.org/prism/data/get/releaseDate/<region>/<res>/<element>/<date>?json=true
// BIL package = .bil (float32, little-endian, row-major, N→S) + .hdr (ULXMAP/ULYMAP =
// upper-left CELL CENTER). normals reject ?format=asc, so BIL is the one format that
// serves both actuals and normals.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Footprint (5-state Northern Plains bbox) + season ────────────────────────────
const LON_MIN = -116.1, LON_MAX = -95.3, LAT_MIN = 40.0, LAT_MAX = 49.0
const SEASON_MONTHS = [4, 5, 6] // Apr–Jun
const ELEMENT = 'ppt', REGION = 'us', RES = '4km'
const BASE = 'https://services.nacse.org/prism/data/get'

const pad2 = (n: number) => String(n).padStart(2, '0')

// Last fully-complete Apr–Jun: that window for year Y closes when July Y begins.
function lastCompleteSeasonYear(): number {
  const now = new Date()
  return now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

// A dated monthly grid is PRISM-"stable" once it's older than ~6 months.
function isStableMonth(year: number, month1: number): boolean {
  const firstOfNextMonth = Date.UTC(year, month1, 1) // month1 is 1-based → index month1 = month after
  return Date.now() - firstOfNextMonth >= 183 * 24 * 3600 * 1000
}

// ── BIL parsing (pure Node — no GeoTIFF/netCDF/asc) ──────────────────────────────
interface BilHeader {
  ncols: number; nrows: number; nbits: number; pixeltype: string; byteorder: string
  ulxmap: number; ulymap: number; xdim: number; ydim: number; nodata: number
}

function parseHdr(text: string): BilHeader {
  const m: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const [k, ...rest] = t.split(/\s+/)
    m[k.toUpperCase()] = rest.join(' ')
  }
  return {
    ncols: parseInt(m.NCOLS, 10), nrows: parseInt(m.NROWS, 10), nbits: parseInt(m.NBITS, 10),
    pixeltype: (m.PIXELTYPE ?? 'FLOAT').toUpperCase(), byteorder: (m.BYTEORDER ?? 'I').toUpperCase(),
    ulxmap: parseFloat(m.ULXMAP), ulymap: parseFloat(m.ULYMAP),
    xdim: parseFloat(m.XDIM), ydim: parseFloat(m.YDIM), nodata: parseFloat(m.NODATA),
  }
}

interface ClippedGrid {
  cells: number[][]            // nrows × ncols, row-major, NODATA preserved
  ncols: number; nrows: number
  xllcorner: number; yllcorner: number; cellsize: number; nodata: number
  stats: { real: number; min: number | null; max: number | null; mean: number | null }
}

// Clip the full-CONUS grid to the footprint by cell-center index math, and convert
// BIL's upper-left-center origin to an ESRI-ASCII lower-left corner for storage.
function clipToFootprint(h: BilHeader, bil: Buffer): ClippedGrid {
  if (h.nbits !== 32 || h.pixeltype !== 'FLOAT' || h.byteorder !== 'I') {
    throw new Error(`unexpected BIL encoding: ${h.pixeltype}/${h.nbits}/${h.byteorder}`)
  }
  if (bil.length !== h.ncols * h.nrows * 4) {
    throw new Error(`bil size ${bil.length} != ncols*nrows*4 (${h.ncols * h.nrows * 4})`)
  }
  const cMin = Math.max(0, Math.ceil((LON_MIN - h.ulxmap) / h.xdim))
  const cMax = Math.min(h.ncols - 1, Math.floor((LON_MAX - h.ulxmap) / h.xdim))
  const rMin = Math.max(0, Math.ceil((h.ulymap - LAT_MAX) / h.ydim))
  const rMax = Math.min(h.nrows - 1, Math.floor((h.ulymap - LAT_MIN) / h.ydim))
  if (cMax < cMin || rMax < rMin) throw new Error('clip window is empty')

  const cells: number[][] = []
  let real = 0, sum = 0, min = Infinity, max = -Infinity
  for (let r = rMin; r <= rMax; r++) {
    const row: number[] = []
    const rowBase = r * h.ncols
    for (let c = cMin; c <= cMax; c++) {
      const v = bil.readFloatLE((rowBase + c) * 4)
      row.push(v)
      if (v !== h.nodata) { real++; sum += v; if (v < min) min = v; if (v > max) max = v }
    }
    cells.push(row)
  }
  return {
    cells, ncols: cMax - cMin + 1, nrows: rMax - rMin + 1,
    xllcorner: h.ulxmap + cMin * h.xdim - h.xdim / 2,
    yllcorner: h.ulymap - rMax * h.ydim - h.ydim / 2,
    cellsize: h.xdim, nodata: h.nodata,
    stats: { real, min: real ? min : null, max: real ? max : null, mean: real ? sum / real : null },
  }
}

// ── Fetch + unzip (shell-out) a BIL grid package ─────────────────────────────────
async function fetchBilGrid(url: string, workDir: string): Promise<{ hdr: BilHeader; bil: Buffer }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('zip')) {
    throw new Error(`expected zip, got "${ct}": ${buf.toString('utf8').slice(0, 160)}`)
  }
  const dir = mkdtempSync(join(workDir, 'grid-'))
  const zipPath = join(dir, 'grid.zip')
  writeFileSync(zipPath, buf)
  execFileSync('unzip', ['-o', zipPath, '-d', dir], { stdio: 'ignore' })
  const files = readdirSync(dir)
  const hdrName = files.find(f => f.toLowerCase().endsWith('.hdr'))
  const bilName = files.find(f => f.toLowerCase().endsWith('.bil'))
  if (!hdrName || !bilName) throw new Error(`no .hdr/.bil in package: ${files.join(', ')}`)
  return {
    hdr: parseHdr(readFileSync(join(dir, hdrName), 'utf8')),
    bil: readFileSync(join(dir, bilName)),
  }
}

// PRISM releaseDate resource → [gridDate, releaseDate, element, stabilityCode, url]
async function fetchReleaseInfo(period: string): Promise<{ releaseDate: string | null; stabilityCode: string | null }> {
  try {
    const res = await fetch(`${BASE}/releaseDate/${REGION}/${RES}/${ELEMENT}/${period}?json=true`)
    if (!res.ok) return { releaseDate: null, stabilityCode: null }
    const arr = (await res.json()) as unknown
    if (!Array.isArray(arr)) return { releaseDate: null, stabilityCode: null }
    const a = arr as unknown[]
    return {
      releaseDate: typeof a[1] === 'string' ? a[1] : null,
      stabilityCode: a[3] != null ? String(a[3]) : null,
    }
  } catch {
    return { releaseDate: null, stabilityCode: null }
  }
}

// ── One ingest target (an actual month or a monthly normal) ──────────────────────
interface Target {
  periodType: 'monthly' | 'normal_monthly'
  period: string          // 'YYYYMM' | 'MM'
  url: string
  releaseDate: string | null
  stabilityCode: string | null
  isStable: boolean
}

async function buildTargets(seasonYear: number): Promise<Target[]> {
  const targets: Target[] = []
  for (const mm of SEASON_MONTHS) {
    const period = `${seasonYear}${pad2(mm)}`
    const rel = await fetchReleaseInfo(period)
    targets.push({
      periodType: 'monthly', period,
      url: `${BASE}/${REGION}/${RES}/${ELEMENT}/${period}?format=bil`,
      releaseDate: rel.releaseDate, stabilityCode: rel.stabilityCode,
      isStable: isStableMonth(seasonYear, mm),
    })
  }
  for (const mm of SEASON_MONTHS) {
    const period = pad2(mm)
    targets.push({
      periodType: 'normal_monthly', period,
      url: `${BASE}/normals/${REGION}/${RES}/${ELEMENT}/${period}?format=bil`,
      releaseDate: null, stabilityCode: 'normal',
      isStable: true, // a fixed 1991–2020 climatology is, by definition, stable
    })
  }
  return targets
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  // Same realtime short-circuit as the cattle/news snapshot jobs (REST-only on Node 20).
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in prism-ingest') } }
  const db: SupabaseClient = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  const seasonYear = lastCompleteSeasonYear()
  console.log(`[prism-ingest] season=${seasonYear} Apr–Jun + monthly normals · footprint lon[${LON_MIN},${LON_MAX}] lat[${LAT_MIN},${LAT_MAX}]`)

  // Skip grids already stored (idempotent + respects the 2-downloads/file/24h limit).
  const { data: existing } = await db
    .from('prism_grid_raw')
    .select('element, period_type, period, resolution, region')
  const have = new Set(
    (existing ?? []).map(r => `${r.element}|${r.period_type}|${r.period}|${r.resolution}|${r.region}`),
  )

  const workDir = mkdtempSync(join(tmpdir(), 'prism-'))
  let upserted = 0, skipped = 0, failed = 0

  try {
    const targets = await buildTargets(seasonYear)
    for (const t of targets) {
      const key2 = `${ELEMENT}|${t.periodType}|${t.period}|${RES}|${REGION}`
      if (have.has(key2)) {
        console.log(`[prism-ingest] skip ${t.periodType} ${t.period} — already stored`)
        skipped++
        continue
      }
      try {
        const { hdr, bil } = await fetchBilGrid(t.url, workDir)
        const g = clipToFootprint(hdr, bil)
        console.log(
          `[prism-ingest] ${t.periodType} ${t.period}: ${g.ncols}×${g.nrows} clip · ` +
          `${g.stats.real} real cells · mm min/mean/max = ` +
          `${g.stats.min?.toFixed(1) ?? '–'}/${g.stats.mean?.toFixed(1) ?? '–'}/${g.stats.max?.toFixed(1) ?? '–'} · ` +
          `stable=${t.isStable} release=${t.releaseDate ?? '—'} code=${t.stabilityCode ?? '—'}`,
        )
        const { error } = await db.from('prism_grid_raw').upsert(
          {
            element: ELEMENT, period_type: t.periodType, period: t.period, resolution: RES, region: REGION,
            ncols: g.ncols, nrows: g.nrows, xllcorner: g.xllcorner, yllcorner: g.yllcorner,
            cellsize: g.cellsize, nodata_value: g.nodata, cells: g.cells,
            release_date: t.releaseDate, stability_code: t.stabilityCode, is_stable: t.isStable,
            source_url: t.url, fetched_at: new Date().toISOString(),
          },
          { onConflict: 'element,period_type,period,resolution,region' },
        )
        if (error) throw new Error(`upsert failed: ${error.message}`)
        console.log(`[prism-ingest] upserted ${t.periodType} ${t.period} ✓`)
        upserted++
      } catch (err) {
        failed++
        console.error(`[prism-ingest] ${t.periodType} ${t.period} FAILED:`, err instanceof Error ? err.message : err)
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  console.log(`[prism-ingest] done — upserted=${upserted} skipped=${skipped} failed=${failed}`)
  // Fail the run only if nothing landed and nothing was already present (total failure).
  if (upserted === 0 && skipped === 0) process.exit(1)
}

main().catch(err => { console.error('[prism-ingest] threw:', err); process.exit(1) })

import 'server-only'
import { inflateRaw } from 'zlib'
import { promisify } from 'util'
import { createServiceClient } from './supabase'

const inflateAsync = promisify(inflateRaw)

const MDO_ZIP = 'https://ftp.cpc.ncep.noaa.gov/GIS/droughtlook/mdo_polygons_latest.zip'
const SDO_ZIP = 'https://ftp.cpc.ncep.noaa.gov/GIS/droughtlook/sdo_polygons_latest.zip'
const BATCH = 500
const PAGE  = 1000

// Sample counties logged after upsert for manual verification against the CPC map.
const VERIFY_FIPS: Array<{ fips: string; label: string }> = [
  { fips: '30069', label: 'Petroleum MT'    },   // user-specified
  { fips: '48113', label: 'Dallas TX'       },   // Texas
  { fips: '12086', label: 'Miami-Dade FL'   },   // Southeast
  { fips: '53033', label: 'King WA'         },   // Pacific Northwest
  { fips: '35049', label: 'Santa Fe NM'     },   // Southwest
  { fips: '08041', label: 'El Paso CO'      },   // Mountain/Plains border
  { fips: '17031', label: 'Cook IL'         },   // Midwest
  { fips: '22071', label: 'Orleans LA'      },   // Gulf South
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbfRecord {
  Outlook:   string  // 'No_Drought' | 'Development' | 'Improvement' | 'Persistence' | 'Removal'
  Fcst_Date: string  // 'MM/DD/YYYY'
  Target:    string  // 'Month YYYY'
}

type Ring = [number, number][]

interface ShpPolygon {
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number }
  rings: Ring[]
}

interface CountyRow {
  id:   number
  fips: string
  lat:  number
  lon:  number
}

// ─── ZIP extraction ───────────────────────────────────────────────────────────

async function extractFromZip(zipBuf: Buffer, targetFile: string): Promise<Buffer> {
  let offset = 0
  while (offset + 30 < zipBuf.length) {
    if (zipBuf.readUInt32LE(offset) !== 0x04034b50) break
    const method    = zipBuf.readUInt16LE(offset + 8)
    const compSize  = zipBuf.readUInt32LE(offset + 18)
    const fnLen     = zipBuf.readUInt16LE(offset + 26)
    const extraLen  = zipBuf.readUInt16LE(offset + 28)
    const fn        = zipBuf.slice(offset + 30, offset + 30 + fnLen).toString('ascii')
    const dataStart = offset + 30 + fnLen + extraLen

    if (fn === targetFile) {
      const raw = zipBuf.slice(dataStart, dataStart + compSize)
      return method === 0 ? raw : await inflateAsync(raw)
    }
    offset += 30 + fnLen + extraLen + compSize
  }
  throw new Error(`"${targetFile}" not found in zip`)
}

// ─── DBF parsing ──────────────────────────────────────────────────────────────

function readDbfRecords(dbf: Buffer): DbfRecord[] {
  const numRecords  = dbf.readUInt32LE(4)
  const headerBytes = dbf.readUInt16LE(8)
  const recordSize  = dbf.readUInt16LE(10)

  const fields: Array<{ name: string; len: number }> = []
  let fOff = 32
  while (fOff + 32 <= headerBytes && dbf[fOff] !== 0x0d) {
    const name = dbf.slice(fOff, fOff + 11).toString('ascii').replace(/\0/g, '').trim()
    const len  = dbf[fOff + 16]
    fields.push({ name, len })
    fOff += 32
  }

  const records: DbfRecord[] = []
  for (let i = 0; i < numRecords; i++) {
    let fieldOff = headerBytes + i * recordSize + 1  // +1 = deletion flag byte
    const row: Record<string, string> = {}
    for (const f of fields) {
      row[f.name] = dbf.slice(fieldOff, fieldOff + f.len).toString('ascii').trim()
      fieldOff += f.len
    }
    records.push(row as unknown as DbfRecord)
  }
  return records
}

// ─── SHP polygon parsing ──────────────────────────────────────────────────────
//
// SHP record layout (all offsets relative to start of the 8-byte record header):
//   [0-3]   record number (big-endian)
//   [4-7]   content length in 16-bit words (big-endian)
//   [8-11]  shape type = 5 (little-endian)
//   [12-43] bounding box: Xmin,Ymin,Xmax,Ymax (4 × double, little-endian)
//   [44-47] NumParts  (int32, little-endian)
//   [48-51] NumPoints (int32, little-endian)
//   [52 …]  Parts array (NumParts × int32)
//   […]     Points array (NumPoints × [x,y] double pairs)

function readShpPolygons(shp: Buffer): ShpPolygon[] {
  const polygons: ShpPolygon[] = []
  let offset = 100  // skip 100-byte file header

  while (offset + 8 <= shp.length) {
    const contentWords = shp.readInt32BE(offset + 4)
    const contentBytes = contentWords * 2
    if (offset + 8 + contentBytes > shp.length) break

    const shapeType = shp.readInt32LE(offset + 8)
    if (shapeType !== 5) {
      offset += 8 + contentBytes
      continue
    }

    const bbox = {
      xmin: shp.readDoubleLE(offset + 12),
      ymin: shp.readDoubleLE(offset + 20),
      xmax: shp.readDoubleLE(offset + 28),
      ymax: shp.readDoubleLE(offset + 36),
    }

    const numParts  = shp.readInt32LE(offset + 44)
    const numPoints = shp.readInt32LE(offset + 48)

    const parts: number[] = []
    for (let p = 0; p < numParts; p++) {
      parts.push(shp.readInt32LE(offset + 52 + p * 4))
    }
    parts.push(numPoints)  // sentinel so parts[p+1] always exists

    const ptsOff = offset + 52 + numParts * 4
    const rings: Ring[] = []
    for (let p = 0; p < numParts; p++) {
      const ring: Ring = []
      for (let j = parts[p]; j < parts[p + 1]; j++) {
        ring.push([
          shp.readDoubleLE(ptsOff + j * 16),
          shp.readDoubleLE(ptsOff + j * 16 + 8),
        ])
      }
      rings.push(ring)
    }

    polygons.push({ bbox, rings })
    offset += 8 + contentBytes
  }

  return polygons
}

// ─── Point-in-polygon (ray-casting, even-odd rule) ───────────────────────────

function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInPolygon(px: number, py: number, poly: ShpPolygon): boolean {
  // Fast bounding-box pre-check
  if (px < poly.bbox.xmin || px > poly.bbox.xmax ||
      py < poly.bbox.ymin || py > poly.bbox.ymax) return false
  // Even-odd rule across all rings handles outer + hole rings
  let inside = false
  for (const ring of poly.rings) {
    if (pointInRing(px, py, ring)) inside = !inside
  }
  return inside
}

// ─── Text / date helpers ──────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function parseFcstDate(s: string): string {
  const [m, d, y] = s.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function lastDayOfMonth(target: string): string {
  const [monthName, yearStr] = target.split(' ')
  const monthIdx = MONTHS.indexOf(monthName)
  const year     = parseInt(yearStr, 10)
  return new Date(Date.UTC(year, monthIdx + 1, 0)).toISOString().slice(0, 10)
}

function outlookText(outlook: string, target: string): string {
  switch (outlook) {
    case 'Persistence': return `Drought conditions are expected to persist through ${target}.`
    case 'Development': return `Drought conditions are likely to develop in this area through ${target}.`
    case 'Improvement': return `Some improvement in drought conditions is possible through ${target}, but full removal is not expected.`
    case 'Removal':     return `Drought removal is likely through ${target}.`
    default:            return `No drought conditions are forecast for this area through ${target}.`
  }
}

// ─── County fetch (paginated) ─────────────────────────────────────────────────

async function fetchCountiesWithCoords(
  db: ReturnType<typeof createServiceClient>,
): Promise<CountyRow[]> {
  const all: CountyRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await db
      .from('counties')
      .select('id, fips, lat, lon')
      .not('lat', 'is', null)
      .not('lon', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`County fetch at ${from} failed: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...(data as CountyRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function storeForecastOutlooks(): Promise<{
  upserted: number
  skipped: number
}> {
  const db = createServiceClient()

  // 1. Download both zips in parallel
  const [mdoBuf, sdoBuf] = await Promise.all([
    fetch(MDO_ZIP, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`MDO zip HTTP ${r.status}`); return r.arrayBuffer() })
      .then(b => Buffer.from(b)),
    fetch(SDO_ZIP, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`SDO zip HTTP ${r.status}`); return r.arrayBuffer() })
      .then(b => Buffer.from(b)),
  ])

  // 2. Extract and parse DBF + SHP from each zip
  const [mdoDbf, mdoShp, sdoDbf, sdoShp] = await Promise.all([
    extractFromZip(mdoBuf, 'DO_Merge_Clip.dbf'),
    extractFromZip(mdoBuf, 'DO_Merge_Clip.shp'),
    extractFromZip(sdoBuf, 'DO_Merge_Clip.dbf'),
    extractFromZip(sdoBuf, 'DO_Merge_Clip.shp'),
  ])

  const mdoAttrs = readDbfRecords(mdoDbf)
  const mdoPolys = readShpPolygons(mdoShp)
  const sdoAttrs = readDbfRecords(sdoDbf)
  const sdoPolys = readShpPolygons(sdoShp)

  // 3. Fetch all counties that have coordinates (paginated)
  const counties = await fetchCountiesWithCoords(db)
  console.log(`[forecast] ${counties.length} counties with coordinates`)

  // 4. For each outlook type, assign a category to every county
  type OutlookRow = {
    county_id:    number
    outlook_type: string
    outlook_text: string
    release_date: string
    valid_through: string
  }

  const allRows: OutlookRow[] = []

  const passes: Array<{ attrs: DbfRecord[]; polys: ShpPolygon[]; type: string }> = [
    { attrs: mdoAttrs, polys: mdoPolys, type: 'monthly'  },
    { attrs: sdoAttrs, polys: sdoPolys, type: 'seasonal' },
  ]

  for (const { attrs, polys, type } of passes) {
    if (attrs.length === 0 || polys.length !== attrs.length) {
      console.warn(`[forecast] ${type}: record count mismatch (attrs=${attrs.length}, polys=${polys.length}) — skipping`)
      continue
    }

    const target     = attrs[0].Target
    const releaseDate = parseFcstDate(attrs[0].Fcst_Date)
    const validThru  = lastDayOfMonth(target)

    for (const county of counties) {
      let matched = 'No_Drought'

      // Test only the 4 "active" categories — No_Drought is the fallback
      for (let i = 0; i < attrs.length; i++) {
        if (attrs[i].Outlook === 'No_Drought') continue
        if (pointInPolygon(county.lon, county.lat, polys[i])) {
          matched = attrs[i].Outlook
          break
        }
      }

      allRows.push({
        county_id:    county.id,
        outlook_type: type,
        outlook_text: outlookText(matched, target),
        release_date: releaseDate,
        valid_through: validThru,
      })
    }

    console.log(`[forecast] ${type}: assigned outlook to ${counties.length} counties (target: ${target})`)
  }

  // 5. Upsert in batches
  for (let i = 0; i < allRows.length; i += BATCH) {
    const { error } = await db
      .from('forecast_outlooks')
      .upsert(allRows.slice(i, i + BATCH), { onConflict: 'county_id,outlook_type,release_date' })
    if (error) throw new Error(`forecast_outlooks upsert failed at batch ${i}: ${error.message}`)
  }

  // 6. Log sample counties for manual verification against the official CPC map
  const byFips = Object.fromEntries(counties.map(c => [c.fips, c]))
  const byCountyId = new Map(allRows.map(r => [`${r.county_id}:${r.outlook_type}`, r]))

  console.log('\n[forecast] ── Sample county outlooks — verify against https://www.cpc.ncep.noaa.gov ──')
  for (const { fips, label } of VERIFY_FIPS) {
    const county = byFips[fips]
    if (!county) { console.log(`  ${label} (${fips}): NOT IN DB WITH COORDS`); continue }
    const mdo = byCountyId.get(`${county.id}:monthly`)
    const sdo = byCountyId.get(`${county.id}:seasonal`)
    console.log(`  ${label} (${fips}):`)
    console.log(`    monthly  → ${mdo?.outlook_text ?? 'N/A'}`)
    console.log(`    seasonal → ${sdo?.outlook_text ?? 'N/A'}`)
  }
  console.log('[forecast] ─────────────────────────────────────────────────────────────────────')

  return {
    upserted: allRows.length,
    skipped:  counties.length * 2 - allRows.length,
  }
}

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// Census Gazetteer 2023 — per-state tab-separated files.
// The "national" txt file no longer exists; Census only publishes per-state files and a zip.
// Each file: USPS  GEOID  ANSICODE  NAME  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG
// GEOID is the 5-digit FIPS code we need.
const GAZ_BASE =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer'

// All 50 states + DC (11) + Puerto Rico (72)
const STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18','19',
  '20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35',
  '36','37','38','39','40','41','42','44','45','46','47','48','49','50','51','53',
  '54','55','56','72',
]

const BATCH = 500

async function fetchStateFile(fips: string): Promise<string> {
  const url = `${GAZ_BASE}/2023_gaz_counties_${fips}.txt`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const text = await res.text()
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Got HTML instead of data from ${url} — Census URL may have changed`)
  }
  return text
}

function parseGazetteerText(
  text: string,
  updates: Array<{ fips: string; lat: number; lon: number }>,
  stateFips: string,
): void {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return

  const header = lines[0].split('\t').map(h => h.trim().toUpperCase())
  const geoidIdx = header.indexOf('GEOID')
  const latIdx   = header.indexOf('INTPTLAT')
  const lonIdx   = header.indexOf('INTPTLONG')

  if (geoidIdx < 0 || latIdx < 0 || lonIdx < 0) {
    throw new Error(
      `State ${stateFips}: unexpected column layout.\n` +
      `Expected GEOID, INTPTLAT, INTPTLONG. Found: ${header.join(' | ')}`,
    )
  }

  for (const line of lines.slice(1)) {
    const cols = line.split('\t')
    const fips = cols[geoidIdx]?.trim()
    const lat  = parseFloat(cols[latIdx]?.trim())
    const lon  = parseFloat(cols[lonIdx]?.trim())
    if (!fips || isNaN(lat) || isNaN(lon)) continue
    updates.push({ fips, lat, lon })
  }
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  console.log(`Fetching ${STATE_FIPS.length} state Gazetteer files…`)
  const updates: Array<{ fips: string; lat: number; lon: number }> = []

  for (const sf of STATE_FIPS) {
    const text = await fetchStateFile(sf)
    parseGazetteerText(text, updates, sf)
    process.stdout.write('.')
  }
  console.log(`\nParsed ${updates.length} county coordinates`)

  // Fetch all county rows — paginate in 1,000-row pages to avoid Supabase's default cap
  const allCounties: Array<{ id: number; fips: string }> = []
  let from = 0
  while (true) {
    const { data, error } = await db
      .from('counties')
      .select('id, fips')
      .range(from, from + BATCH - 1)
    if (error) throw new Error(`Failed to fetch counties (page at ${from}): ${error.message}`)
    if (!data || data.length === 0) break
    allCounties.push(...data)
    if (data.length < BATCH) break
    from += BATCH
  }
  console.log(`Loaded ${allCounties.length} county rows from DB`)

  const fipsToId = Object.fromEntries(allCounties.map(c => [c.fips, c.id]))

  // Build rows for upsert (include all non-null required columns isn't practical;
  // use update-by-id instead — one request per county is acceptable for a one-time script)
  let updated = 0
  let skipped = 0

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    await Promise.all(
      batch.map(async ({ fips, lat, lon }) => {
        const id = fipsToId[fips]
        if (!id) { skipped++; return }

        const { error } = await db.from('counties').update({ lat, lon }).eq('id', id)
        if (error) {
          console.warn(`  ✗ FIPS ${fips}: ${error.message}`)
        } else {
          updated++
        }
      }),
    )
    console.log(`  ${Math.min(i + BATCH, updates.length)} / ${updates.length} processed`)
  }

  console.log(`Done — updated ${updated} counties, skipped ${skipped} (not in DB)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

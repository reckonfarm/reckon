import 'server-only'
import { createServiceClient } from './supabase'

const CPC_BASE = 'https://www.cpc.ncep.noaa.gov/products/expert_assessment'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Upserts up to 3 records into official_maps:
 *   usdm_national  — USDM color map image, verified live before storing
 *   cpc_monthly    — CPC Monthly Drought Outlook image (fixed URL, always current)
 *   cpc_seasonal   — CPC Seasonal Drought Outlook image (fixed URL, always current)
 *
 * weekDate is the Tuesday data-as-of date from drought ingestion (YYYY-MM-DD).
 * USDM's map is published on the following Thursday, so release_date = weekDate + 2.
 * CPC release_date is derived from the image's Last-Modified HTTP header.
 *
 * On any fetch failure the existing row in official_maps is left untouched
 * (last-known-good semantics).
 */
export async function storeOfficialMaps(weekDate: string): Promise<{
  upserted: number
}> {
  const db = createServiceClient()

  // USDM publishes on Thursday; weekDate is the prior Tuesday (data as-of)
  const dataTuesday    = new Date(`${weekDate}T00:00:00Z`)
  const releaseThursday = toISODate(new Date(dataTuesday.getTime() + 2 * 86_400_000))
  const compact        = weekDate.replace(/-/g, '')  // YYYYMMDD for the image path

  type MapRow = {
    map_type: string
    scope: null
    release_date: string
    image_url: string
    source_url: string
  }

  const maps: MapRow[] = []

  // ── USDM national map ──────────────────────────────────────────────────────
  // Image path uses the Tuesday date; release_date is the Thursday of publication.
  const usdmUrl = `https://droughtmonitor.unl.edu/data/png/${compact}/${compact}_usdm_web_all.png`
  const usdmHead = await fetch(usdmUrl, { method: 'HEAD', cache: 'no-store' })
  if (usdmHead.ok) {
    maps.push({
      map_type:     'usdm_national',
      scope:        null,
      release_date: releaseThursday,
      image_url:    usdmUrl,
      source_url:   'https://droughtmonitor.unl.edu/CurrentMap.aspx',
    })
  } else {
    console.warn(`[maps] USDM national map not found for ${compact} (HTTP ${usdmHead.status}) — prior record kept`)
  }

  // ── CPC maps (fixed URLs; Last-Modified header gives the release date) ─────
  const cpcTargets = [
    {
      map_type:   'cpc_monthly',
      img_path:   'month_drought.png',
      src_path:   'mdo_summary.php',
    },
    {
      map_type:   'cpc_seasonal',
      img_path:   'season_drought.png',
      src_path:   'sdo_summary.php',
    },
  ] as const

  for (const { map_type, img_path, src_path } of cpcTargets) {
    const imgUrl = `${CPC_BASE}/${img_path}`
    const head   = await fetch(imgUrl, { method: 'HEAD', cache: 'no-store' })
    if (!head.ok) {
      console.warn(`[maps] ${map_type} unavailable (HTTP ${head.status}) — prior record kept`)
      continue
    }
    const lastMod    = head.headers.get('last-modified')
    const releaseDate = lastMod ? toISODate(new Date(lastMod)) : toISODate(new Date())
    maps.push({
      map_type,
      scope:        null,
      release_date: releaseDate,
      image_url:    imgUrl,
      source_url:   `${CPC_BASE}/${src_path}`,
    })
  }

  if (maps.length === 0) return { upserted: 0 }

  // Upsert one at a time to avoid batch issues with null scope in the conflict target
  for (const map of maps) {
    const { error } = await db
      .from('official_maps')
      .upsert(map, { onConflict: 'map_type,scope,release_date' })
    if (error) throw new Error(`official_maps upsert failed for ${map.map_type}: ${error.message}`)
  }

  console.log(`[maps] upserted ${maps.length}: ${maps.map(m => m.map_type).join(', ')}`)
  return { upserted: maps.length }
}

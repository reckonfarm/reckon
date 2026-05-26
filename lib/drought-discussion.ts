import 'server-only'

const USDM_STATS_BASE = 'https://usdmdataservices.unl.edu/api'
const USDM_SUMMARY_BASE = 'https://droughtmonitor.unl.edu/services/data/summary/xml'

// USDM assigns each state to one of 8 geographic regions for narrative discussions.
// Source: https://droughtmonitor.unl.edu/About/WhatistheUSDM.aspx
const STATE_TO_REGION: Record<string, string> = {
  CT: 'Northeast', DE: 'Northeast', MA: 'Northeast', MD: 'Northeast',
  ME: 'Northeast', NH: 'Northeast', NJ: 'Northeast', NY: 'Northeast',
  PA: 'Northeast', RI: 'Northeast', VT: 'Northeast', WV: 'Northeast',
  AL: 'Southeast', FL: 'Southeast', GA: 'Southeast', KY: 'Southeast',
  NC: 'Southeast', SC: 'Southeast', TN: 'Southeast', VA: 'Southeast',
  AR: 'South', LA: 'South', MS: 'South', OK: 'South', TX: 'South',
  IL: 'Midwest', IN: 'Midwest', IA: 'Midwest', MI: 'Midwest',
  MN: 'Midwest', MO: 'Midwest', OH: 'Midwest', WI: 'Midwest',
  CO: 'High Plains', KS: 'High Plains', MT: 'High Plains',
  NE: 'High Plains', ND: 'High Plains', SD: 'High Plains', WY: 'High Plains',
  AK: 'West', AZ: 'West', CA: 'West', HI: 'West', ID: 'West',
  NM: 'West', NV: 'West', OR: 'West', UT: 'West', WA: 'West',
  PR: 'Caribbean',
}

export interface DroughtDiscussion {
  author: string
  affiliation: string
  intro: string
  regionText: string
  regionName: string
  releaseDate: string
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractInnerXml(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1] : ''
}

function extractText(xml: string, tag: string): string {
  const inner = extractInnerXml(xml, tag)
  return decodeEntities(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

// Extract each <p> as a paragraph, joined by \n\n. Falls back to raw inner text.
function extractParagraphs(xml: string): string {
  const matches = [...xml.matchAll(/<p>([\s\S]*?)<\/p>/gi)]
  if (matches.length > 0) {
    return matches
      .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
      .filter(Boolean)
      .join('\n\n')
  }
  return decodeEntities(xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getLatestMapDate(): Promise<string> {
  const today = new Date()
  const twoWeeksAgo = new Date(today)
  twoWeeksAgo.setDate(today.getDate() - 14)

  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
  const url =
    `${USDM_STATS_BASE}/USStatistics/GetDroughtSeverityStatisticsByArea` +
    `?aoi=us&startdate=${fmt(twoWeeksAgo)}&enddate=${fmt(today)}&statisticsType=1`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 86400 },
  })
  if (!res.ok) throw new Error(`USDM stats API ${res.status}`)

  const data = await res.json() as Array<Record<string, unknown>>
  // Handle both camelCase (mapDate) and PascalCase (MapDate) from the API
  const latest = data
    .map(r => String(r.mapDate ?? r.MapDate ?? ''))
    .filter(Boolean)
    .sort()
    .at(-1)

  if (!latest) throw new Error('No mapDate in USDM stats response')
  // Normalize: '2026-05-19T00:00:00' → '20260519'
  return latest.slice(0, 10).replace(/-/g, '')
}

export async function getDroughtDiscussion(stateAbbr: string): Promise<DroughtDiscussion | null> {
  let dateStr: string
  try {
    dateStr = await getLatestMapDate()
  } catch (err) {
    console.error('[drought-discussion] failed to get latest map date:', err)
    return null
  }

  const xmlUrl = `${USDM_SUMMARY_BASE}/usdm_summary_${dateStr}.xml`
  let xml: string
  try {
    const res = await fetch(xmlUrl, { next: { revalidate: 86400 } })
    if (!res.ok) {
      console.error(`[drought-discussion] XML fetch returned ${res.status} for ${xmlUrl}`)
      return null
    }
    xml = await res.text()
  } catch (err) {
    console.error('[drought-discussion] XML fetch failed:', err)
    return null
  }

  const authorXml = extractInnerXml(xml, 'author')
  const author = extractText(authorXml, 'name')
  const affiliation = extractText(authorXml, 'affiliation')

  const introXml = extractInnerXml(xml, 'intro')
  const intro = extractParagraphs(introXml)

  const regionName = STATE_TO_REGION[stateAbbr.toUpperCase()] ?? 'West'
  const regionMatch = xml.match(
    new RegExp(`<region[^>]*name=["']${regionName}["'][^>]*>([\\s\\S]*?)<\\/region>`, 'i'),
  )
  const regionText = regionMatch ? extractParagraphs(regionMatch[1]) : ''

  // mapDate is the Tuesday data-as-of date; USDM releases on the following Thursday
  const year  = parseInt(dateStr.slice(0, 4), 10)
  const month = parseInt(dateStr.slice(4, 6), 10) - 1
  const day   = parseInt(dateStr.slice(6, 8), 10)
  const thursday = new Date(Date.UTC(year, month, day + 2))
  const releaseDate = thursday.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })

  return { author, affiliation, intro, regionText, regionName, releaseDate }
}

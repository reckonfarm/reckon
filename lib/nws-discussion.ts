import 'server-only'

const NWS_BASE = 'https://api.weather.gov'
const HEADERS = {
  'User-Agent': 'dryline.farm/1.0 contact@dryline.farm',
  Accept: 'application/json',
}

const SKIP_SECTIONS = new Set([
  'AVIATION',
  'MARINE',
  'FIRE WEATHER',
  'WATCHES WARNINGS ADVISORIES',
])

export interface NwsDiscussion {
  discussionText: string
  issuanceTime: string
  wfo: string
}

function extractForecastText(productText: string): string {
  const sectionRe = /^\.[A-Z][A-Z0-9 /_-]+\.\.\./m
  const firstMatch = sectionRe.exec(productText)
  if (!firstMatch) return ''

  // Work only from the first section header onwards (skip WMO header lines)
  const body = productText.slice(firstMatch.index).split(/\n\$\$/)[0].split(/\n(?=[A-Z]{2}\.\.\.)/m)[0]

  // Split on section boundaries: lines starting with .WORD WORD...
  const parts = body.split(/(?=^\.[A-Z][A-Z0-9 /_-]+\.\.\.)/m)
  const kept: string[] = []

  for (const part of parts) {
    const headerMatch = /^\.[A-Z][A-Z0-9 /_-]+\.\.\./.exec(part)
    if (!headerMatch) continue

    // Extract bare section name: ".SHORT TERM..." → "SHORT TERM"
    const sectionName = headerMatch[0].replace(/^\.|\.\.\.$/g, '').trim()
    if (Array.from(SKIP_SECTIONS).some(s => sectionName.startsWith(s))) continue

    // Strip the header line itself and trim
    const content = part.slice(headerMatch[0].length).replace(/^\n/, '').trim()
    if (content) kept.push(content)
  }

  return kept.join('\n\n').replace(/\n&&\n/g, '\n').replace(/^&&$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

async function fetchDiscussion(lat: number, lon: number): Promise<NwsDiscussion | null> {
  // Step 1: lat/lon → WFO (3-letter cwa)
  const pointsRes = await fetch(
    `${NWS_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers: HEADERS, next: { revalidate: 3600 } },
  )
  if (!pointsRes.ok) return null
  const pointsData = await pointsRes.json() as { properties?: { cwa?: string } }
  const cwa = pointsData.properties?.cwa
  if (!cwa) return null

  // Step 2: single call returns full productText — no UUID lookup needed
  const afdRes = await fetch(
    `${NWS_BASE}/products/types/AFD/locations/${cwa}/latest`,
    { headers: HEADERS, next: { revalidate: 3600 } },
  )
  if (!afdRes.ok) return null
  const afd = await afdRes.json() as { productText?: string; issuanceTime?: string }
  if (!afd.productText || !afd.issuanceTime) return null

  const discussionText = extractForecastText(afd.productText)
  if (!discussionText) return null

  return { discussionText, issuanceTime: afd.issuanceTime, wfo: cwa }
}

export async function getNwsDiscussion(
  lat: number,
  lon: number,
): Promise<NwsDiscussion | null> {
  try {
    const result = await Promise.race([
      fetchDiscussion(lat, lon),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 12000)),
    ])
    return result
  } catch {
    return null
  }
}

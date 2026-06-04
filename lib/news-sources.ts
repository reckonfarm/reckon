// ─── Markets news source whitelist + relevance config ──────────────────────────
//
// Curated, hand-picked feeds only — NO discovery, NO crawling. Each entry is a
// standard RSS 2.0 feed verified to return title/link/pubDate/description. The
// /api/news route fetches these, keyword-filters, dedups, and recency-sorts.
//
// Deliberately EXCLUDED (bot-walled or no usable RSS, proven during recon):
// Drovers, AgWeb (PerimeterX 403), Pro Farmer, DTN. Do not add them back without
// re-probing from Vercel — they block datacenter egress like ams.usda.gov does.
// AgDaily was also dropped: it timed out from Vercel's datacenter egress (the other
// three came through clean on the preview).

export type NewsScope = 'national' | 'regional'

export interface NewsSource {
  id: string
  name: string
  url: string
  scope: NewsScope
  // For regional sources: the states this outlet primarily covers. An item from a
  // source whose regionStates includes the visitor's state gets the regional boost.
  regionStates?: string[]
}

export const NEWS_SOURCES: NewsSource[] = [
  {
    id: 'beef-magazine',
    name: 'Beef Magazine',
    url: 'https://www.beefmagazine.com/rss.xml',
    scope: 'national',
  },
  {
    id: 'tsln',
    name: 'Tri-State Livestock News',
    url: 'https://www.tsln.com/feed/',
    scope: 'regional',
    regionStates: ['MT', 'ND', 'SD', 'WY', 'NE'],
  },
  {
    id: 'western-ag',
    name: 'Western Ag Reporter',
    url: 'https://www.westernagreporter.com/feed/',
    scope: 'regional',
    regionStates: ['MT', 'WY', 'ND', 'SD'],
  },
]

// Relevance gate: an item is kept only if its title or snippet matches one of these
// (word-boundary, case-insensitive). Keeps the feed on cattle/ranch/markets and out
// of generic ag fluff. Kept broad enough not to drop genuinely relevant headlines.
export const KEYWORDS = [
  'cattle', 'beef', 'feeder', 'cow', 'calf', 'calves', 'heifer', 'steer',
  'hay', 'forage', 'drought', 'market', 'markets', 'price', 'prices',
  'lfp', 'grazing', 'ranch', 'rancher', 'pasture', 'herd',
]

// States making up the "Northern Plains" — the signed-in regional emphasis. Used to
// expand the boost: a visitor in any of these also gets items mentioning the region
// or its sister states bumped, not just their exact state.
export const NORTHERN_PLAINS = new Set(['MT', 'ND', 'SD', 'WY', 'NE'])

// Minimal state code → name map for text-based regional matching. Full 50 so any
// visitor's home state name is matchable in an article body; no external dep.
export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

// Lowercased text terms whose presence in an article should trigger the regional
// boost for a visitor in `state`. Empty when state is unknown.
export function boostTermsForState(state: string | null): string[] {
  if (!state) return []
  const code = state.toUpperCase()
  const terms = new Set<string>()
  const name = US_STATE_NAMES[code]
  if (name) terms.add(name.toLowerCase())
  if (NORTHERN_PLAINS.has(code)) {
    terms.add('northern plains')
    for (const s of NORTHERN_PLAINS) {
      const n = US_STATE_NAMES[s]
      if (n) terms.add(n.toLowerCase())
    }
  }
  return [...terms]
}

// True when a source is regional AND covers the visitor's state.
export function isRegionalSourceForState(src: NewsSource, state: string | null): boolean {
  if (!state || !src.regionStates) return false
  return src.regionStates.includes(state.toUpperCase())
}

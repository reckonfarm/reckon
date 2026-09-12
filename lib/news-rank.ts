// ─── News ranking — ONE pipeline, shared by the route and the card ────────────
//
// Why this file exists (Block 7B.1). The ranking used to live only in
// MarketsNews.tsx and run in the browser over every item the route returned:
// 147 items and 76 KB on the wire so that NewsHookCard could show 3. That is
// the cab-on-one-bar cost, and capping the route is the fix.
//
// But the route could not simply slice its own list. Its order is
// regional-first-then-recency; the card's order is SUBSTANTIVE-first
// (markets/drought beat human-interest profiles), then partitioned into local
// and national tiers with a diversified lead. Those two orders disagree, so a
// route that returned "its own top 10" would drop items the card would have
// shown and show items the card would have sunk — a quieter bug than a slow
// page, and a worse one.
//
// So the whole pipeline moved here, pure and framework-free, and BOTH sides
// call selectHeadlines(). The route ranks the full candidate set and sends only
// what will be rendered; the card renders what it is sent, in order. They agree
// by construction rather than by two people keeping two sorts in step.
//
// Nothing about the ORDER changed in this extraction — same categories, same
// keys, same lead window. Only the address changed.

export interface NewsItem {
  title: string
  link: string
  pubDate: string | null // ISO 8601, or null if unparseable
  source: string
  sourceId: string
  scope: 'national' | 'regional'
  snippet: string
  regional: boolean // matched the visitor's region → render "Near you"
  ts: number // epoch ms for sort; 0 when pubDate is unknown
}

/** The /api/news response contract. */
export interface NewsResponse {
  items: NewsItem[]
  /**
   * Candidates BEFORE ?limit truncated them. A card that asked for 3 has no
   * other way to know a fourth exists, and "More headlines" must not vanish
   * just because the wire got cheaper.
   */
  total?: number
  region: string | null
  error?: boolean
  sources?: { id: string; name: string; ok: boolean; count: number }[]
}

// ─── categorization (pure, from title+snippet alone — no new data source) ─────
// Word-boundary on both sides keeps short words precise — "cowboy"/"important"/
// "bulletin" don't false-match cow/import/bull. Zero-match falls back to
// 'ranching' (the catch-all) so nothing is ever unreachable behind a toggle.

export type Category = 'markets' | 'drought' | 'ranching'

const CATEGORY_WORDS: Record<Category, string[]> = {
  markets: [
    'price', 'prices', 'sale', 'sales', 'market', 'markets', 'trade', 'trades',
    'packer', 'packers', 'feedlot', 'feedlots', 'cattle on feed', 'futures', 'basis',
    'export', 'exports', 'import', 'imports', 'tariff', 'tariffs', 'policy', 'usda',
    'demand', 'supply', 'cutout', 'boxed beef',
  ],
  drought: [
    'drought', 'forage', 'moisture', 'rain', 'rains', 'rainfall', 'precip',
    'precipitation', 'conditions', 'grazing', 'pasture', 'pastures', 'range',
    'rangeland', 'water', 'monsoon', 'hay',
  ],
  ranching: [
    'herd', 'herds', 'cow', 'cows', 'calf', 'calves', 'heifer', 'heifers', 'bull',
    'bulls', 'management', 'production', 'health', 'vaccine', 'vaccines', 'genetics',
    'breeding', 'branding', 'weaning',
  ],
}

const CATEGORY_RE: Record<Category, RegExp> = {
  markets: new RegExp(`\\b(?:${CATEGORY_WORDS.markets.join('|')})\\b`, 'i'),
  drought: new RegExp(`\\b(?:${CATEGORY_WORDS.drought.join('|')})\\b`, 'i'),
  ranching: new RegExp(`\\b(?:${CATEGORY_WORDS.ranching.join('|')})\\b`, 'i'),
}

export function categorize(item: NewsItem): Set<Category> {
  const text = `${item.title} ${item.snippet}`
  const cats = new Set<Category>()
  if (CATEGORY_RE.markets.test(text)) cats.add('markets')
  if (CATEGORY_RE.drought.test(text)) cats.add('drought')
  if (CATEGORY_RE.ranching.test(text)) cats.add('ranching')
  if (cats.size === 0) cats.add('ranching') // fallback catch-all
  return cats
}

// Market/conditions news is "substantive"; human-interest profiles (which miss
// those keywords) are not — this is the outer ranking key so profiles sink.
export function isSubstantive(cats: Set<Category>): boolean {
  return cats.has('markets') || cats.has('drought')
}

export interface RankedItem extends NewsItem {
  categories: Set<Category>
  substantive: boolean
}

// Within a tier: substantive (markets/drought) → recency. `regional` is NOT a
// sort key here — it is the TIER PARTITION, applied by selectHeadlines.
export function rankItems(items: NewsItem[]): RankedItem[] {
  return items
    .map(it => {
      const categories = categorize(it)
      return { ...it, categories, substantive: isSubstantive(categories) }
    })
    .sort((a, b) => {
      if (a.substantive !== b.substantive) return a.substantive ? -1 : 1
      return b.ts - a.ts
    })
}

// Lead diversification: within the first LEAD_WINDOW local items, allow at most
// LEAD_MAX_PER_SOURCE from any one source, so the lead isn't a wall of one
// outlet (TSLN/Agweek batch-publish and dominate the freshest). Only the lead
// window is reordered; everything past it stays in recency order. Items bumped
// from the lead fall in right after it, so nothing is lost.
const LEAD_WINDOW = 4
const LEAD_MAX_PER_SOURCE = 2

export function diversifyLead(items: RankedItem[]): RankedItem[] {
  if (items.length <= 1) return items
  const lead: RankedItem[] = []
  const deferred: RankedItem[] = []
  const rest: RankedItem[] = []
  const counts = new Map<string, number>()
  for (const it of items) {
    if (lead.length >= LEAD_WINDOW) {
      rest.push(it)
      continue
    }
    const c = counts.get(it.sourceId) ?? 0
    if (c < LEAD_MAX_PER_SOURCE) {
      lead.push(it)
      counts.set(it.sourceId, c + 1)
    } else {
      deferred.push(it)
    }
  }
  // If too many were deferred to fill the lead (e.g. one dominant source),
  // backfill from the deferred head so the lead window is never left short.
  while (lead.length < LEAD_WINDOW && deferred.length > 0) {
    lead.push(deferred.shift() as RankedItem)
  }
  return [...lead, ...deferred, ...rest]
}

/**
 * THE reading order: local river (ranked, with the diversified lead) ahead of
 * the national tail. `limit` truncates the finished order — never the input —
 * so the Nth item is the same item whether N is applied here or in the browser.
 *
 * Returns plain NewsItems: `categories` is a Set and would cross the wire as
 * `{}`, and no renderer reads it.
 */
export function selectHeadlines(items: NewsItem[], limit?: number | null): NewsItem[] {
  const ranked = rankItems(items)
  const ordered = [
    ...diversifyLead(ranked.filter(it => it.regional)),
    ...ranked.filter(it => !it.regional),
  ]
  const cut = limit == null ? ordered : ordered.slice(0, Math.max(0, limit))
  return cut.map(stripRank)
}

function stripRank(it: RankedItem): NewsItem {
  return {
    title: it.title,
    link: it.link,
    pubDate: it.pubDate,
    source: it.source,
    sourceId: it.sourceId,
    scope: it.scope,
    snippet: it.snippet,
    regional: it.regional,
    ts: it.ts,
  }
}

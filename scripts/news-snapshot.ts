// ─── News snapshot writer (Slice 0 — data layer only) ────────────────────────────
//
// Runs OFF Vercel (GitHub Actions, or locally for seeding) where feeds that 403 /
// time out on Vercel's datacenter egress (e.g. AgDaily) come through clean. Fetches
// its OWN curated feed list (defined HERE — it deliberately does NOT import
// lib/news-sources.ts, so the live route's 3-feed whitelist stays frozen), runs the
// relevance + scope + locality "brain", dedups keeping the most-local copy, and
// UPSERTS one row per headline into public.news_items (idempotent on link).
//
// NOTHING reads news_items yet. The live news path (app/api/news/route.ts) is
// untouched. Wiring a reader is a later, separate slice.
//
//   Local seed:  npx tsx scripts/news-snapshot.ts
//   CI:          same, with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
//
// COPYRIGHT: headline + short snippet (~200 chars) + link only. Never full text.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ─── This script's OWN feed list (separate from the live route on purpose) ───────
// scope is stamped from the source tier, no text analysis. `states` is the source's
// coverage, used only by the locality brain's confidence check. national feeds are
// keyword-gated; state/regional feeds are trusted (relaxed gate) — they're already
// ag outlets. The first three match the live route; the rest are the verified adds
// (AgDaily included — reachable here via Actions egress, not via Vercel).

type Scope = 'national' | 'state' | 'regional'

interface Feed {
  id: string
  name: string
  url: string
  scope: Scope
  states: string[] // coverage (2-letter, uppercase); [] for national
}

const FEEDS: Feed[] = [
  // ── national (keyword-gated) ──
  { id: 'beef-magazine', name: 'Beef Magazine', url: 'https://www.beefmagazine.com/rss.xml', scope: 'national', states: [] },
  { id: 'beef-central', name: 'Beef Central', url: 'https://www.beefcentral.com/feed/', scope: 'national', states: [] },
  { id: 'brownfield', name: 'Brownfield Ag News', url: 'https://www.brownfieldagnews.com/feed/', scope: 'national', states: [] },
  { id: 'agdaily', name: 'AgDaily', url: 'https://www.agdaily.com/feed/', scope: 'national', states: [] },
  // ── regional (multi-state; trusted) ──
  { id: 'tsln', name: 'Tri-State Livestock News', url: 'https://www.tsln.com/feed/', scope: 'regional', states: ['MT', 'ND', 'SD', 'WY', 'NE'] },
  { id: 'western-ag', name: 'Western Ag Reporter', url: 'https://www.westernagreporter.com/feed/', scope: 'regional', states: ['MT', 'WY', 'ND', 'SD'] },
  { id: 'northern-ag', name: 'Northern Ag Network', url: 'https://www.northernag.net/feed/', scope: 'regional', states: ['MT', 'WY', 'ND', 'SD'] },
  { id: 'agweek', name: 'Agweek', url: 'https://www.agweek.com/index.rss', scope: 'regional', states: ['ND', 'SD', 'MT', 'MN'] },
  // ── state (single-state; trusted) ──
  { id: 'mt-stockgrowers', name: 'Montana Stockgrowers', url: 'https://mtbeef.org/feed/', scope: 'state', states: ['MT'] },
  { id: 'nd-ag', name: 'North Dakota Dept of Agriculture', url: 'https://www.nd.gov/ndda/rss.xml', scope: 'state', states: ['ND'] },
  { id: 'ne-ag', name: 'Nebraska Dept of Agriculture', url: 'https://nda.nebraska.gov/rss.xml', scope: 'state', states: ['NE'] },
  { id: 'unl-cropwatch', name: 'UNL CropWatch', url: 'https://cropwatch.unl.edu/rss.xml', scope: 'state', states: ['NE'] },
  { id: 'unl-ianr', name: 'UNL IANR News', url: 'https://ianrnews.unl.edu/rss.xml', scope: 'state', states: ['NE'] },
]

const FEED_TIMEOUT_MS = 10000
const SNIPPET_MAX = 200
const UA = 'Mozilla/5.0 (compatible; DrylineBot/1.0; +https://dryline.farm) AppleWebKit/537.36'

// ─── relevance gate (national only; state/regional trusted) ──────────────────────
const KEYWORDS = [
  'cattle', 'beef', 'feeder', 'cow', 'calf', 'calves', 'heifer', 'steer',
  'hay', 'forage', 'alfalfa', 'grazing', 'pasture', 'drought', 'cull', 'bull',
  'ranch', 'rancher', 'auction', 'lfp', 'cattle on feed', 'cattle-on-feed',
]
const KEYWORD_RE = new RegExp(`\\b(?:${KEYWORDS.join('|')})\\b`, 'i')

// ─── inlined RSS 2.0 parser ──────────────────────────────────────────────────────
// A copy of the live route's hand-rolled parser, inlined here so the script shares
// NO module with route.ts (extracting from route.ts would touch the live path). All
// feeds are standard RSS/Atom with <item|entry><title><link><pubDate><description>.

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n: string) => safeCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => safeCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&') // ampersand last so it can't double-decode
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
}

function firstTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : null
}

function extractLink(block: string): string | null {
  const inline = firstTag(block, 'link')
  if (inline && inline.trim()) return decodeEntities(inline).trim()
  const href = block.match(/<link[^>]*\shref=["']([^"']+)["']/i)
  return href ? decodeEntities(href[1]).trim() : null
}

function cleanText(raw: string | null): string {
  if (!raw) return ''
  return decodeEntities(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
}

interface RawItem {
  title: string
  link: string
  snippet: string
  pubDate: string | null
  ts: number
}

function parseFeed(xml: string): RawItem[] {
  // RSS <item> or Atom <entry>.
  const blocks = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi) ?? []
  const out: RawItem[] = []
  for (const block of blocks) {
    const title = cleanText(firstTag(block, 'title'))
    const link = extractLink(block)
    if (!title || !link) continue
    const snippet = truncate(
      cleanText(firstTag(block, 'description') ?? firstTag(block, 'summary') ?? firstTag(block, 'content')),
      SNIPPET_MAX,
    )
    const rawDate =
      firstTag(block, 'pubDate') ?? firstTag(block, 'dc:date') ?? firstTag(block, 'published') ?? firstTag(block, 'updated')
    let pubDate: string | null = null
    let ts = 0
    if (rawDate) {
      const parsed = new Date(decodeEntities(rawDate).trim())
      if (!Number.isNaN(parsed.getTime())) {
        pubDate = parsed.toISOString()
        ts = parsed.getTime()
      }
    }
    out.push({ title, link, snippet, pubDate, ts })
  }
  return out
}

// ─── locality brain (county-name → fips_hint + confidence) ───────────────────────
// HONEST by construction: a hint is only emitted when the text explicitly says
// "<Name> County/Counties" (bare common-word names like "Park"/"Valley" never
// trigger). confidence is 'high' ONLY when the matched county's state is in the
// source's coverage; 'low' for an unambiguous match the source can't corroborate;
// and NO hint at all when the name is ambiguous across states and the source agrees
// with none of them (we never guess which county). Auction towns are a later add.

interface County {
  fips: string
  name: string
  state: string // 2-letter, uppercase
}

interface CountyMatcher {
  re: RegExp
  byState: Map<string, County> // state → the county of that name in that state
  fipsSet: Set<string>
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Build one matcher per distinct county NAME (names repeat across states).
function buildCountyMatchers(counties: County[]): CountyMatcher[] {
  const byName = new Map<string, County[]>()
  for (const c of counties) {
    const key = c.name.toLowerCase()
    const arr = byName.get(key)
    if (arr) arr.push(c)
    else byName.set(key, [c])
  }
  const matchers: CountyMatcher[] = []
  for (const [name, group] of byName) {
    // Require an explicit "County"/"Counties" mention adjacent to the name.
    const re = new RegExp(`\\b${escapeRe(name)}\\s+count(?:y|ies)\\b`, 'i')
    const byState = new Map<string, County>()
    const fipsSet = new Set<string>()
    for (const c of group) {
      byState.set(c.state, c)
      fipsSet.add(c.fips)
    }
    matchers.push({ re, byState, fipsSet })
  }
  return matchers
}

interface Locality {
  fips_hint: string | null
  confidence: 'high' | 'low' | null
}

function resolveLocality(text: string, sourceStates: string[], matchers: CountyMatcher[]): Locality {
  const sourceSet = new Set(sourceStates)
  let best: Locality = { fips_hint: null, confidence: null }
  for (const m of matchers) {
    if (!m.re.test(text)) continue
    // Does any state this name exists in agree with the source's coverage?
    let agreed: County | null = null
    for (const st of sourceSet) {
      const c = m.byState.get(st)
      if (c) { agreed = c; break }
    }
    if (agreed) {
      // County match AND source state agree → the only path to high confidence.
      return { fips_hint: agreed.fips, confidence: 'high' }
    }
    // No agreement. Emit a low-confidence hint ONLY if the name is unambiguous
    // (resolves to a single county); otherwise we cannot honestly pick one.
    if (m.fipsSet.size === 1 && best.confidence === null) {
      const only = m.byState.values().next().value as County
      best = { fips_hint: only.fips, confidence: 'low' }
    }
  }
  return best
}

// ─── dedup (keep the most-local copy across tiers) ───────────────────────────────
const LOCALITY_RANK: Record<Scope, number> = { state: 0, regional: 1, national: 2 }

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function linkKey(link: string): string {
  try {
    const u = new URL(link)
    return (u.host + u.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return link.toLowerCase()
  }
}

// ─── one row, ready to upsert ────────────────────────────────────────────────────
interface NewsRow {
  title: string
  link: string
  pub_date: string | null
  source: string
  source_id: string
  scope: Scope
  state: string | null
  fips_hint: string | null
  confidence: 'high' | 'low' | null
  snippet: string
  ts: number
}

// ─── feed fetch (one source, fully isolated — a failure is skipped, never thrown) ─
async function fetchFeed(feed: Feed, matchers: CountyMatcher[]): Promise<{ rows: NewsRow[]; ok: boolean; err?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    const raw = parseFeed(xml)
    if (raw.length === 0) throw new Error('no items parsed')

    // national feeds are keyword-gated; state/regional are trusted (relaxed).
    const gated = feed.scope === 'national'
    const rows: NewsRow[] = []
    for (const r of raw) {
      const text = `${r.title} ${r.snippet}`
      if (gated && !KEYWORD_RE.test(text)) continue
      const loc = resolveLocality(text, feed.states, matchers)
      rows.push({
        title: r.title,
        link: r.link,
        pub_date: r.pubDate,
        source: feed.name,
        source_id: feed.id,
        scope: feed.scope,
        state: feed.scope === 'state' ? feed.states[0] ?? null : null,
        fips_hint: loc.fips_hint,
        confidence: loc.confidence,
        snippet: r.snippet,
        ts: r.ts,
      })
    }
    return { rows, ok: true }
  } catch (err) {
    return { rows: [], ok: false, err: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Supabase service-role client (auth pattern cloned from cattle-snapshot.ts) ───
function makeClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  // supabase-js eagerly resolves a WebSocket constructor for realtime and throws on
  // Node ≤20. We only do REST reads/writes, so a never-instantiated transport
  // short-circuits that. (No 'ws' dependency.)
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in news-snapshot') } }
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })
}

const NORTHERN_PLAINS = ['MT', 'ND', 'SD', 'WY', 'NE']

async function loadCounties(db: SupabaseClient): Promise<County[]> {
  // Focus the locality dictionary on the Northern Plains target region: keeps it
  // tight and avoids cross-country false positives on shared county names.
  const { data, error } = await db
    .from('counties')
    .select('fips, name, state')
    .in('state', NORTHERN_PLAINS)
  if (error) {
    console.error('[news-snapshot] counties load failed:', error.message)
    return []
  }
  return (data ?? [])
    .filter((c): c is { fips: string; name: string; state: string } => !!c.fips && !!c.name && !!c.state)
    .map(c => ({ fips: String(c.fips), name: c.name, state: c.state.toUpperCase() }))
}

async function main() {
  const db = makeClient()

  const counties = await loadCounties(db)
  const matchers = buildCountyMatchers(counties)
  console.log(`[news-snapshot] county dictionary: ${counties.length} counties → ${matchers.length} distinct names`)

  console.log(`[news-snapshot] fetching ${FEEDS.length} feeds …`)
  const results = await Promise.all(FEEDS.map(f => fetchFeed(f, matchers)))
  results.forEach((r, i) => {
    const f = FEEDS[i]
    console.log(`  ${r.ok ? '✓' : '✗'} ${f.name} (${f.scope}) — ${r.ok ? `${r.rows.length} items` : `FAILED: ${r.err}`}`)
  })

  // All feeds failed → exit non-zero, write nothing.
  if (results.every(r => !r.ok)) {
    console.error('[news-snapshot] every feed failed — writing nothing.')
    process.exit(1)
  }

  // Combine, then dedup keeping the MOST-LOCAL copy (state > regional > national),
  // freshest within the same tier.
  const combined = results.flatMap(r => r.rows)
  combined.sort((a, b) => {
    const la = LOCALITY_RANK[a.scope]
    const lb = LOCALITY_RANK[b.scope]
    if (la !== lb) return la - lb
    return b.ts - a.ts
  })

  const seen = new Set<string>()
  const rows: NewsRow[] = []
  for (const it of combined) {
    const tkey = `t:${normalizeTitle(it.title)}`
    const lkey = `l:${linkKey(it.link)}`
    if (seen.has(tkey) || seen.has(lkey)) continue
    seen.add(tkey)
    seen.add(lkey)
    rows.push(it)
  }

  console.log(`[news-snapshot] ${combined.length} fetched → ${rows.length} after dedup`)

  if (rows.length === 0) {
    console.error('[news-snapshot] nothing to write after filtering/dedup.')
    process.exit(1)
  }

  // Idempotent upsert on the link natural key.
  const { error } = await db.from('news_items').upsert(rows, { onConflict: 'link' })
  if (error) {
    console.error('[news-snapshot] upsert failed:', error.message)
    process.exit(1)
  }

  const tagged = rows.filter(r => r.fips_hint).length
  const high = rows.filter(r => r.confidence === 'high').length
  console.log(`[news-snapshot] upserted ${rows.length} rows ✓  (locality-hinted: ${tagged}, high-confidence: ${high})`)
}

main().catch(err => { console.error('[news-snapshot] threw:', err); process.exit(1) })

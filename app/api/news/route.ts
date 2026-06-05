import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  NEWS_SOURCES,
  KEYWORDS,
  NORTHERN_PLAINS,
  boostTermsForState,
  isRegionalSourceForState,
  type NewsSource,
} from '@/lib/news-sources'

// GET /api/news — on-request, region-aware ag-news aggregator.
//
// Cloned from the /api/layers/usdm proxy pattern: each upstream feed gets its own
// AbortController timeout cleared in finally, fetched with next:{revalidate:600} so
// the heavy work (4 external feeds) is shared in the data cache and "current within
// ~10 min". A single feed that fails/times-out/returns junk is SKIPPED — the route
// serves the rest and never 500s. Only if ALL feeds fail do we return error:true
// with no-store (a failure is never cached as success).
//
// Region: ?fips= (→ counties→state, the same lookup /cattle runs) or, absent that,
// the x-vercel-ip-country-region geo header (same signal the homepage driest chips
// use). With a known state, regional-source and region-mentioning items are boosted
// to the top and flagged regional:true (the UI's "Near you" badge). No new auth.
//
// COPYRIGHT: we emit headline + short snippet (~200 chars) + link out ONLY. Never
// full article text.

const FEED_TIMEOUT_MS = 8000
const SNIPPET_MAX = 200
const UA =
  'Mozilla/5.0 (compatible; DrylineBot/1.0; +https://dryline.farm) AppleWebKit/537.36'

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

export interface SourceStatus {
  id: string
  name: string
  ok: boolean
  count: number
  error?: string
}

// ─── tiny RSS 2.0 parser (no dependency) ──────────────────────────────────────
// All four whitelisted feeds are standard RSS 2.0 with <item><title><link>
// <pubDate><description>. Hand-rolled to avoid adding an XML dependency; tolerant
// of CDATA, numeric/HTML entities, and href-style <link> as a fallback.

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
  // Atom-style <link href="..."/> fallback.
  const href = block.match(/<link[^>]*\shref=["']([^"']+)["']/i)
  return href ? decodeEntities(href[1]).trim() : null
}

function cleanText(raw: string | null): string {
  if (!raw) return ''
  return decodeEntities(raw)
    .replace(/<[^>]+>/g, ' ') // strip any HTML in the description
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

function parseRss(xml: string): RawItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const out: RawItem[] = []
  for (const block of blocks) {
    const title = cleanText(firstTag(block, 'title'))
    const link = extractLink(block)
    if (!title || !link) continue
    const snippet = truncate(
      cleanText(firstTag(block, 'description') ?? firstTag(block, 'summary')),
      SNIPPET_MAX,
    )
    const rawDate =
      firstTag(block, 'pubDate') ?? firstTag(block, 'dc:date') ?? firstTag(block, 'published')
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

// ─── relevance + dedup helpers ────────────────────────────────────────────────

const KEYWORD_RE = new RegExp(`\\b(?:${KEYWORDS.join('|')})\\b`, 'i')

function isRelevant(item: RawItem): boolean {
  return KEYWORD_RE.test(`${item.title} ${item.snippet}`)
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function linkKey(link: string): string {
  try {
    const u = new URL(link)
    return (u.host + u.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return link.toLowerCase()
  }
}

// ─── region resolution (no new auth) ──────────────────────────────────────────

async function resolveState(req: NextRequest): Promise<string | null> {
  const fips = req.nextUrl.searchParams.get('fips')
  if (fips) {
    try {
      const db = createServiceClient()
      const { data } = await db.from('counties').select('state').eq('fips', fips).single()
      const st = (data as { state: string } | null)?.state
      if (st) return st.toUpperCase()
    } catch {
      // fall through to the geo header — fips lookup failing is non-fatal
    }
  }
  const region = req.headers.get('x-vercel-ip-country-region') ?? ''
  return region.length === 2 ? region.toUpperCase() : null
}

// ─── feed fetch (one source, fully isolated) ──────────────────────────────────

async function fetchFeed(
  src: NewsSource,
  state: string | null,
  boostTerms: string[],
): Promise<{ items: NewsItem[]; status: SourceStatus }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const res = await fetch(src.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      next: { revalidate: 600 },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    const raw = parseRss(xml)
    if (raw.length === 0) throw new Error('no items parsed')

    const sourceRegional = isRegionalSourceForState(src, state)
    const items: NewsItem[] = raw
      .filter(isRelevant)
      .map(r => {
        const textRegional =
          boostTerms.length > 0 &&
          boostTerms.some(t => `${r.title} ${r.snippet}`.toLowerCase().includes(t))
        return {
          title: r.title,
          link: r.link,
          pubDate: r.pubDate,
          source: src.name,
          sourceId: src.id,
          scope: src.scope,
          snippet: r.snippet,
          regional: sourceRegional || textRegional,
          ts: r.ts,
        }
      })

    return { items, status: { id: src.id, name: src.name, ok: true, count: items.length } }
  } catch (err) {
    return {
      items: [],
      status: {
        id: src.id,
        name: src.name,
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── table read path (Slice 1) ────────────────────────────────────────────────
// Reads the pre-tagged snapshot rows (written off-Vercel by the news-snapshot cron,
// covering the full tagged feed set — richer than the 3 live-fetch sources) and
// shapes them into the EXACT same response the live-fetch path produces, so the UI
// renders unchanged. The `regional` "Near you" flag is recomputed per request from
// the visitor's state (it is visitor-specific and never stored). Returns null when
// the table is empty or the read errors — the caller then falls back to live-fetch.

const TABLE_READ_LIMIT = 150
// Older than this and the cron has likely stalled → fall back to live-fetch so the
// feed is never stale-but-pretending-fresh.
const TABLE_STALE_MS = 6 * 60 * 60 * 1000 // 6h

interface NewsRow {
  title: string
  link: string
  pub_date: string | null
  source: string
  source_id: string
  scope: string
  state: string | null
  snippet: string | null
  ts: number | string | null
}

// Recompute the per-visitor "Near you" flag from a stored row, mirroring the live
// path's source-level + text-level logic (with NORTHERN_PLAINS sister-state
// expansion). Stored scope/state stand in for the live path's regionStates.
function rowRegional(row: NewsRow, state: string | null, boostTerms: string[]): boolean {
  const text = `${row.title} ${row.snippet ?? ''}`.toLowerCase()
  if (boostTerms.length > 0 && boostTerms.some(t => text.includes(t))) return true
  if (!state) return false
  const code = state.toUpperCase()
  if (row.scope === 'national') return false
  if (row.scope === 'regional') return NORTHERN_PLAINS.has(code) // NP regional papers
  if (row.scope === 'state' && row.state) {
    const rs = row.state.toUpperCase()
    return rs === code || (NORTHERN_PLAINS.has(rs) && NORTHERN_PLAINS.has(code))
  }
  return false
}

async function readNewsFromTable(
  state: string | null,
  boostTerms: string[],
): Promise<{ items: NewsItem[]; sources: SourceStatus[] } | null> {
  let rows: NewsRow[]
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('news_items')
      .select('title, link, pub_date, source, source_id, scope, state, snippet, ts')
      .order('ts', { ascending: false })
      .limit(TABLE_READ_LIMIT)
    if (error) return null
    rows = (data ?? []) as NewsRow[]
  } catch {
    return null
  }
  if (rows.length === 0) return null

  const mapped: NewsItem[] = rows.map(r => ({
    title: r.title,
    link: r.link,
    // Normalize to the same ISO ("…Z") form the live path emits → byte-identical field.
    pubDate: r.pub_date ? new Date(r.pub_date).toISOString() : null,
    source: r.source,
    sourceId: r.source_id,
    // Contract's scope union is national|regional; state-tier rows collapse to
    // 'regional' (the UI ignores `scope`; the `regional` boolean drives "Near you").
    scope: r.scope === 'national' ? 'national' : 'regional',
    snippet: r.snippet ?? '',
    regional: rowRegional(r, state, boostTerms),
    ts: Number(r.ts ?? 0),
  }))

  // Same ordering + dedup as the live path: regional-first, then recency.
  mapped.sort((a, b) => {
    if (a.regional !== b.regional) return a.regional ? -1 : 1
    return b.ts - a.ts
  })
  const seen = new Set<string>()
  const items: NewsItem[] = []
  for (const it of mapped) {
    const key = normalizeTitle(it.title)
    const lk = linkKey(it.link)
    if (seen.has(key) || seen.has(lk)) continue
    seen.add(key)
    seen.add(lk)
    items.push(it)
  }

  // Synthesize the diagnostic `sources` array (kept for shape parity; UI ignores it).
  const counts = new Map<string, { name: string; count: number }>()
  for (const it of items) {
    const c = counts.get(it.sourceId)
    if (c) c.count++
    else counts.set(it.sourceId, { name: it.source, count: 1 })
  }
  const sources: SourceStatus[] = [...counts.entries()].map(([id, v]) => ({
    id,
    name: v.name,
    ok: true,
    count: v.count,
  }))

  return { items, sources }
}

// Epoch ms of the most recently ingested row, or 0 if the table is empty/errors.
// Drives the staleness gate: a stalled cron must not serve old news as if current.
async function newestIngestedMs(): Promise<number> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('news_items')
      .select('ingested_at')
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return 0
    const t = new Date((data as { ingested_at: string }).ingested_at).getTime()
    return Number.isNaN(t) ? 0 : t
  } catch {
    return 0
  }
}

export async function GET(request: NextRequest) {
  const state = await resolveState(request)
  const boostTerms = boostTermsForState(state)

  // Prefer the pre-tagged snapshot (the full, richer tagged feed set, sourced off
  // the render path). Serve it only when it is present AND fresh; otherwise fall
  // THROUGH to the original live-fetch path below — empty table, stale cron, or any
  // read error all degrade to live-fetch, so the feed is never dead.
  const freshMs = await newestIngestedMs()
  if (freshMs > 0 && Date.now() - freshMs < TABLE_STALE_MS) {
    const table = await readNewsFromTable(state, boostTerms)
    if (table && table.items.length > 0) {
      return NextResponse.json(
        { items: table.items, region: state, sources: table.sources },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600',
            Vary: 'x-vercel-ip-country-region',
          },
        },
      )
    }
  }

  // ── fallback: original live-fetch path (unchanged) ──────────────────────────
  const results = await Promise.all(NEWS_SOURCES.map(s => fetchFeed(s, state, boostTerms)))
  const sources = results.map(r => r.status)

  // All feeds failed → honest error, never cached.
  if (sources.every(s => !s.ok)) {
    return NextResponse.json(
      { items: [], error: true, region: state, sources },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Combine, dedup (regional/recency-best copy wins), recency within boost tier.
  const combined = results.flatMap(r => r.items)
  combined.sort((a, b) => {
    if (a.regional !== b.regional) return a.regional ? -1 : 1
    return b.ts - a.ts
  })

  const seen = new Set<string>()
  const items: NewsItem[] = []
  for (const it of combined) {
    const key = normalizeTitle(it.title)
    const lk = linkKey(it.link)
    if (seen.has(key) || seen.has(lk)) continue
    seen.add(key)
    seen.add(lk)
    items.push(it)
  }

  return NextResponse.json(
    { items, region: state, sources },
    {
      headers: {
        // Region varies by ?fips (in the URL → CDN-keyed) and by the geo header
        // (→ Vary so the edge can't serve one region's ordering to another).
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600',
        Vary: 'x-vercel-ip-country-region',
      },
    },
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

// Markets news feed UI. Reads /api/news (region-aware: passes through ?fips when the
// surface knows a county, else the route falls back to the geo header). Headline +
// short snippet + link out only — never full text. Regional matches sort to top and
// carry a "Near you" badge. On-brand loading/empty/error states — never a dead box.

interface NewsItem {
  title: string
  link: string
  pubDate: string | null
  source: string
  sourceId: string
  scope: 'national' | 'regional'
  snippet: string
  regional: boolean
  ts: number
}

interface NewsResponse {
  items: NewsItem[]
  region: string | null
  error?: boolean
  sources?: { id: string; name: string; ok: boolean; count: number }[]
}

type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; items: NewsItem[]; region: string | null }

// ─── categorization + ranking (pure, client-side over the already-fetched items) ──
// Each item is multi-tagged from its title+snippet alone (no new data source). Word-
// boundary on both sides keeps short words precise — "cowboy"/"important"/"bulletin"
// don't false-match cow/import/bull. Zero-match falls back to 'ranching' (the catch-
// all) so nothing is ever unreachable behind a toggle.

type Category = 'markets' | 'drought' | 'ranching'

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

function categorize(item: NewsItem): Set<Category> {
  const text = `${item.title} ${item.snippet}`
  const cats = new Set<Category>()
  if (CATEGORY_RE.markets.test(text)) cats.add('markets')
  if (CATEGORY_RE.drought.test(text)) cats.add('drought')
  if (CATEGORY_RE.ranching.test(text)) cats.add('ranching')
  if (cats.size === 0) cats.add('ranching') // fallback catch-all
  return cats
}

// Market/conditions news is "substantive"; human-interest profiles (which miss those
// keywords) are not — this is the outer ranking key so profiles sink below them.
function isSubstantive(cats: Set<Category>): boolean {
  return cats.has('markets') || cats.has('drought')
}

interface RankedItem extends NewsItem {
  categories: Set<Category>
  substantive: boolean
}

// substantive → regional (boosts within substance) → recency.
function rankItems(items: NewsItem[]): RankedItem[] {
  return items
    .map(it => {
      const categories = categorize(it)
      return { ...it, categories, substantive: isSubstantive(categories) }
    })
    .sort((a, b) => {
      if (a.substantive !== b.substantive) return a.substantive ? -1 : 1
      if (a.regional !== b.regional) return a.regional ? -1 : 1
      return b.ts - a.ts
    })
}

const NO_ITEMS: NewsItem[] = []

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NearYouBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rust/10 px-2 py-0.5 font-dm-sans text-[11px] font-semibold text-rust">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-rust" />
      Near you
    </span>
  )
}

function ExternalArrow() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-shrink-0 text-forest-green/30 transition-colors group-hover:text-forest-green/60"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 13L13 7M13 7H8M13 7v5" />
      <rect x="3" y="3" width="14" height="14" rx="3" />
    </svg>
  )
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-forest-green/10 bg-white p-4 shadow-sm transition-colors hover:border-forest-green/25 sm:p-5"
    >
      <div className="mb-2 flex items-center gap-2">
        {item.regional && <NearYouBadge />}
        <span className="font-dm-sans text-xs font-medium text-forest-green/50">{item.source}</span>
        {item.pubDate && (
          <>
            <span className="text-forest-green/20" aria-hidden="true">
              ·
            </span>
            <span className="font-dm-sans text-xs text-forest-green/40">
              {relativeTime(item.pubDate)}
            </span>
          </>
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-fraunces text-base font-semibold leading-snug text-forest-green group-hover:text-forest-green/80 sm:text-lg">
          {item.title}
        </h3>
        <span className="pt-1">
          <ExternalArrow />
        </span>
      </div>
      {item.snippet && (
        <p className="mt-1.5 line-clamp-2 font-dm-sans text-sm leading-relaxed text-forest-green/60">
          {item.snippet}
        </p>
      )}
    </a>
  )
}

// Skeleton uses a scoped keyframe (the Tailwind `animate-pulse` utility is disabled
// in this project's @theme), so it shimmers without touching any shared style file.
function NewsSkeleton() {
  return (
    <>
      <style>{`@keyframes dlNewsShimmer{0%,100%{opacity:.55}50%{opacity:.85}}.dl-news-skel{animation:dlNewsShimmer 1.4s ease-in-out infinite}`}</style>
      <div className="space-y-4" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-xl border border-forest-green/10 bg-white p-4 shadow-sm sm:p-5">
            <div className="dl-news-skel mb-3 h-3 w-28 rounded bg-forest-green/10" />
            <div className="dl-news-skel h-4 w-11/12 rounded bg-forest-green/10" />
            <div className="dl-news-skel mt-2 h-4 w-3/5 rounded bg-forest-green/10" />
            <div className="dl-news-skel mt-3 h-3 w-full rounded bg-forest-green/5" />
          </div>
        ))}
      </div>
    </>
  )
}

function UnavailablePanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-8 text-center shadow-sm">
      <p className="font-fraunces text-base font-semibold text-forest-green">
        News briefly unavailable
      </p>
      <p className="mx-auto mt-1 max-w-sm font-dm-sans text-sm leading-relaxed text-forest-green/60">
        We couldn&apos;t reach the news sources just now — back shortly.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center rounded-lg border border-forest-green/20 px-4 py-2 font-dm-sans text-sm font-semibold text-forest-green transition-colors hover:bg-forest-green/5"
      >
        Try again
      </button>
    </div>
  )
}

function EmptyPanel() {
  return (
    <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-8 text-center shadow-sm">
      <p className="font-fraunces text-base font-semibold text-forest-green">
        No cattle-country headlines right now
      </p>
      <p className="mx-auto mt-1 max-w-sm font-dm-sans text-sm leading-relaxed text-forest-green/60">
        Nothing new from our sources at the moment — check back soon.
      </p>
    </div>
  )
}

export default function MarketsNews({ fips }: { fips?: string | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(
    async (bustCache = false) => {
      setState({ phase: 'loading' })
      try {
        const qs = fips ? `?fips=${encodeURIComponent(fips)}` : ''
        const res = await fetch(`/api/news${qs}`, bustCache ? { cache: 'reload' } : undefined)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as NewsResponse
        if (data.error) {
          setState({ phase: 'error' })
          return
        }
        setState({ phase: 'ready', items: data.items ?? [], region: data.region ?? null })
      } catch {
        setState({ phase: 'error' })
      }
    },
    [fips],
  )

  useEffect(() => {
    load()
  }, [load])

  // Rank the already-fetched items client-side (no refetch). NO_ITEMS is a stable
  // reference so the memo doesn't recompute while loading/erroring.
  const items = state.phase === 'ready' ? state.items : NO_ITEMS
  const ranked = useMemo(() => rankItems(items), [items])

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
            Cattle country news
          </h2>
          <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
            The latest from across the beef, hay, and ranch markets.
          </p>
        </div>
      </div>

      {state.phase === 'loading' && <NewsSkeleton />}
      {state.phase === 'error' && <UnavailablePanel onRetry={() => load(true)} />}
      {state.phase === 'ready' &&
        (ranked.length === 0 ? (
          <EmptyPanel />
        ) : (
          <div className="space-y-4">
            {ranked.map(item => (
              <NewsCard key={item.link} item={item} />
            ))}
          </div>
        ))}
    </section>
  )
}

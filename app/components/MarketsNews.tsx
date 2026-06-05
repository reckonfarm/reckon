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

// Within a tier: substantive (markets/drought) → recency. `regional` is NO LONGER a
// sort key — it's the TIER PARTITION (local vs national) done in the render body.
function rankItems(items: NewsItem[]): RankedItem[] {
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
// LEAD_MAX_PER_SOURCE from any one source, so the lead isn't a wall of one outlet
// (TSLN/Agweek batch-publish and dominate the freshest). Only the lead window is
// reordered; everything past it stays in recency order. Items bumped from the lead
// fall in right after it (still recency-ordered), so nothing is lost.
const LEAD_WINDOW = 6
const LEAD_MAX_PER_SOURCE = 2

function diversifyLead(items: RankedItem[]): RankedItem[] {
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
  // If too many were deferred to fill the lead (e.g. one dominant source), backfill
  // from the deferred head so the lead window is never left short.
  while (lead.length < LEAD_WINDOW && deferred.length > 0) {
    lead.push(deferred.shift() as RankedItem)
  }
  return [...lead, ...deferred, ...rest]
}

const NO_ITEMS: NewsItem[] = []
const LOCAL_PAGE = 8
const NATIONAL_PAGE = 5

// Northern Plains state code → name for the local-tier header. County hints are ~0
// in the data, so this tier is honestly region-level ("your region"), never county.
const NP_STATE_NAMES: Record<string, string> = {
  MT: 'Montana', ND: 'North Dakota', SD: 'South Dakota', WY: 'Wyoming', NE: 'Nebraska',
}

function localTierHeader(region: string | null): string {
  const name = region ? NP_STATE_NAMES[region.toUpperCase()] : undefined
  return name ? `${name} & the Northern Plains` : 'Near you'
}

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

function NewsCard({
  item,
  hideRegionalBadge = false,
}: {
  item: NewsItem
  hideRegionalBadge?: boolean
}) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-forest-green/10 bg-white p-4 shadow-sm transition-colors hover:border-forest-green/25 sm:p-5"
    >
      {/* Title leads — the thing the user scans and taps. */}
      <h3 className="font-fraunces text-lg font-semibold leading-snug text-forest-green group-hover:text-forest-green/80 sm:text-xl">
        {item.title}
      </h3>
      {item.snippet && (
        <p className="mt-2 line-clamp-2 font-dm-sans text-sm leading-relaxed text-forest-green/55">
          {item.snippet}
        </p>
      )}
      {/* Quiet meta footer — source · time, with the badge and link affordance. */}
      <div className="mt-3 flex items-center gap-2">
        {item.regional && !hideRegionalBadge && <NearYouBadge />}
        <span className="font-dm-sans text-[11px] font-medium text-forest-green/45">
          {item.source}
        </span>
        {item.pubDate && (
          <>
            <span className="text-forest-green/20" aria-hidden="true">
              ·
            </span>
            <span className="font-dm-sans text-[11px] text-forest-green/40">
              {relativeTime(item.pubDate)}
            </span>
          </>
        )}
        <span className="ml-auto">
          <ExternalArrow />
        </span>
      </div>
    </a>
  )
}

// Compact row for the secondary National tier — lighter than NewsCard (no snippet,
// smaller title, border-separated) so national visibly recedes beneath the local
// river. Same headline-only + link-out contract.
function NewsCardCompact({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-baseline justify-between gap-3 py-3"
    >
      <div className="min-w-0">
        <h3 className="font-fraunces text-base font-semibold leading-snug text-forest-green group-hover:text-forest-green/80">
          {item.title}
        </h3>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-dm-sans text-[11px] font-medium text-forest-green/45">
            {item.source}
          </span>
          {item.pubDate && (
            <>
              <span className="text-forest-green/20" aria-hidden="true">
                ·
              </span>
              <span className="font-dm-sans text-[11px] text-forest-green/40">
                {relativeTime(item.pubDate)}
              </span>
            </>
          )}
        </div>
      </div>
      <span className="mt-0.5 flex-shrink-0">
        <ExternalArrow />
      </span>
    </a>
  )
}

// Section header for a tier — title + a quiet item count.
function TierHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-4 flex items-baseline gap-2">
      <h3 className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
        {title}
      </h3>
      <span className="font-dm-sans text-sm font-medium text-forest-green/40">{count}</span>
    </div>
  )
}

function LoadMore({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mt-6 text-center">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center rounded-lg border border-forest-green/20 px-5 py-2.5 font-dm-sans text-sm font-semibold text-forest-green transition-colors hover:bg-forest-green/5"
      >
        {label}
      </button>
    </div>
  )
}

// Quiet per-tier empty line — honest when a filter empties one tier; the other tier
// still renders. Never a fabricated item.
function TierEmpty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-forest-green/10 bg-white px-5 py-6 text-center font-dm-sans text-sm text-forest-green/55 shadow-sm">
      {text}
    </p>
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

// Distinct from the all-empty panel: feeds DID return news, just none in this filter.
function FilterEmptyPanel({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-8 text-center shadow-sm">
      <p className="font-fraunces text-base font-semibold text-forest-green">
        Nothing in {label} right now
      </p>
      <p className="mx-auto mt-1 max-w-sm font-dm-sans text-sm leading-relaxed text-forest-green/60">
        No headlines match this filter at the moment.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 inline-flex items-center rounded-lg border border-forest-green/20 px-4 py-2 font-dm-sans text-sm font-semibold text-forest-green transition-colors hover:bg-forest-green/5"
      >
        Show all news
      </button>
    </div>
  )
}

type FilterKey = 'all' | Category

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'markets', label: 'Prices' },
  { key: 'drought', label: 'Conditions' },
  { key: 'ranching', label: 'Herd' },
]

function FilterBar({
  active,
  onChange,
}: {
  active: FilterKey
  onChange: (key: FilterKey) => void
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter news">
      {FILTERS.map(f => {
        const isActive = f.key === active
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            aria-pressed={isActive}
            className={
              'rounded-full px-4 py-2 font-dm-sans text-sm font-semibold transition-colors ' +
              (isActive
                ? 'bg-forest-green text-white'
                : 'border border-forest-green/20 text-forest-green/70 hover:border-forest-green/40 hover:text-forest-green')
            }
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}

export default function MarketsNews({ fips }: { fips?: string | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [filter, setFilter] = useState<FilterKey>('all')
  const [localVisible, setLocalVisible] = useState(LOCAL_PAGE)
  const [nationalVisible, setNationalVisible] = useState(NATIONAL_PAGE)

  // Changing the filter resets BOTH tier slices so a new filter starts at the top.
  const changeFilter = useCallback((key: FilterKey) => {
    setFilter(key)
    setLocalVisible(LOCAL_PAGE)
    setNationalVisible(NATIONAL_PAGE)
  }, [])

  const load = useCallback(
    async (bustCache = false) => {
      setState({ phase: 'loading' })
      setLocalVisible(LOCAL_PAGE)
      setNationalVisible(NATIONAL_PAGE)
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
  const region = state.phase === 'ready' ? state.region : null
  const ranked = useMemo(() => rankItems(items), [items])
  const filtered = useMemo(
    () => (filter === 'all' ? ranked : ranked.filter(it => it.categories.has(filter))),
    [ranked, filter],
  )
  // The tier partition: `regional` splits the filtered set into the primary local
  // river and the secondary national tail. Each preserves the substantive→recency
  // order from rankItems.
  const local = useMemo(() => diversifyLead(filtered.filter(it => it.regional)), [filtered])
  const national = useMemo(() => filtered.filter(it => !it.regional), [filtered])
  // Does this visitor get ANY local content (across all categories)? Distinguishes
  // "unknown location → no local tier" from "this filter emptied the local tier".
  const hasAnyLocal = useMemo(() => ranked.some(it => it.regional), [ranked])
  const activeLabel = FILTERS.find(f => f.key === filter)?.label ?? 'this filter'
  const filterPhrase = filter === 'all' ? '' : `${activeLabel.toLowerCase()} `

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
            Cattle Country
          </h2>
          <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
            The headlines moving cattle, hay, and ranch markets.
          </p>
        </div>
      </div>

      {state.phase === 'loading' && <NewsSkeleton />}
      {state.phase === 'error' && <UnavailablePanel onRetry={() => load(true)} />}
      {state.phase === 'ready' &&
        (ranked.length === 0 ? (
          <EmptyPanel />
        ) : (
          <>
            <FilterBar active={filter} onChange={changeFilter} />
            {filtered.length === 0 ? (
              <FilterEmptyPanel label={activeLabel} onClear={() => changeFilter('all')} />
            ) : (
              <div className="space-y-10">
                {/* TIER 1 — LOCAL: primary river. Shown only when this visitor gets
                    local content at all; a filter that empties it shows a quiet line. */}
                {hasAnyLocal && (
                  <div>
                    <TierHeader title={localTierHeader(region)} count={local.length} />
                    {local.length > 0 ? (
                      <>
                        <div className="space-y-4">
                          {local.slice(0, localVisible).map(item => (
                            <NewsCard key={item.link} item={item} hideRegionalBadge />
                          ))}
                        </div>
                        {localVisible < local.length && (
                          <LoadMore
                            label="More from your region"
                            onClick={() => setLocalVisible(v => v + LOCAL_PAGE)}
                          />
                        )}
                      </>
                    ) : (
                      <TierEmpty text={`No ${filterPhrase}headlines in your region right now.`} />
                    )}
                  </div>
                )}

                {/* TIER 2 — NATIONAL: the compact tail. Becomes the primary "Top
                    stories" feed when there's no local tier (unknown location). */}
                {national.length > 0 ? (
                  <div>
                    <TierHeader title={hasAnyLocal ? 'National' : 'Top stories'} count={national.length} />
                    {!hasAnyLocal && region === null && (
                      <p className="mb-4 -mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/55">
                        Set your county to see Northern Plains news.
                      </p>
                    )}
                    <div className="divide-y divide-forest-green/10 border-t border-forest-green/10">
                      {national.slice(0, nationalVisible).map(item => (
                        <NewsCardCompact key={item.link} item={item} />
                      ))}
                    </div>
                    {nationalVisible < national.length && (
                      <LoadMore
                        label="More national"
                        onClick={() => setNationalVisible(v => v + NATIONAL_PAGE)}
                      />
                    )}
                  </div>
                ) : (
                  hasAnyLocal && (
                    <div>
                      <TierHeader title="National" count={0} />
                      <TierEmpty text={`No ${filterPhrase}headlines from national sources right now.`} />
                    </div>
                  )
                )}
              </div>
            )}
          </>
        ))}
    </section>
  )
}

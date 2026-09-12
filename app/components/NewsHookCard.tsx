'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { NewsCardCompact } from '@/app/components/MarketsNews'
import type { NewsItem, NewsResponse } from '@/lib/news-rank'

// The headline news hook — the ENTIRE news surface after the Boring purge
// (North Star v3 §6: news demoted from the default view to a hook inside Today).
// 3 headlines; "More headlines" expands IN PLACE to 10; every headline links OUT
// to its article. Dryline is still not a reader.
//
// WHAT CHANGED IN 7B.1: it asks for what it shows. This card used to pull the
// whole river — 147 items and 75,601 bytes — so it could rank client-side and
// keep 10. On one bar in the cab that is the most expensive thing on Today, and
// it bought three headlines. Now the route ranks (lib/news-rank.ts, the same
// pipeline this file used to run) and sends 3: 1,545 bytes. The expansion pays
// for the other seven only when a thumb asks for them, and only once — the
// widened list is kept, so collapse-and-expand-again is free.
//
// `total` from the route is what keeps "More headlines" honest. With 3 items in
// hand the card cannot see a fourth; total says how many candidates there were.
//
// HONESTY STATES, unchanged and load-bearing: loading ≠ error ≠ empty. A failed
// fetch says the headlines are unavailable — it must never render as "no news
// right now," which is a claim about the world rather than about the network.
// The same rule governs the expansion: if widening fails, the three already on
// screen stay exactly where they are and the card says only that it could not
// get more.

type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; items: NewsItem[]; total: number }

const HEADLINE_COUNT = 3
const EXPANDED_COUNT = 10

export default function NewsHookCard({ fips }: { fips?: string | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  // Expansion survives a county swap on purpose: it's a view preference, not
  // county state, and the swap already holds the previous list rather than
  // flashing.
  const [expanded, setExpanded] = useState(false)
  const [widening, setWidening] = useState(false)
  const [wideningFailed, setWideningFailed] = useState(false)

  // Promise-chain fetch with a cancelled flag (mirrors BottomTabBar's pattern; no
  // synchronous setState in the effect body). Initial state already shows the
  // skeleton; on a fips change the previous county's headlines hold for the
  // sub-second swap rather than flashing back to skeleton.
  useEffect(() => {
    let cancelled = false
    fetch(newsUrl(fips, HEADLINE_COUNT))
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<NewsResponse>
      })
      .then(data => {
        if (cancelled) return
        if (data.error) {
          setState({ phase: 'error' })
          return
        }
        const items = data.items ?? []
        setState({ phase: 'ready', items, total: data.total ?? items.length })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' })
      })
    return () => { cancelled = true }
  }, [fips])

  async function toggle() {
    if (state.phase !== 'ready') return
    if (expanded) { setExpanded(false); return }
    // Already hold everything the expansion would show → no second request.
    if (state.items.length >= Math.min(EXPANDED_COUNT, state.total)) { setExpanded(true); return }
    setWidening(true)
    setWideningFailed(false)
    try {
      const res = await fetch(newsUrl(fips, EXPANDED_COUNT))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as NewsResponse
      if (data.error) throw new Error('feed error')
      const items = data.items ?? []
      // A short reply is not a reason to shrink what is already on screen.
      if (items.length < state.items.length) throw new Error('short reply')
      setState({ phase: 'ready', items, total: data.total ?? items.length })
      setExpanded(true)
    } catch {
      setWideningFailed(true) // the three on screen stay put
    } finally {
      setWidening(false)
    }
  }

  const shown = state.phase === 'ready'
    ? (expanded ? state.items : state.items.slice(0, HEADLINE_COUNT))
    : []
  const more = state.phase === 'ready'
    && Math.min(state.total, EXPANDED_COUNT) > HEADLINE_COUNT

  return (
    <div data-audit="news-hook">
      <p className="mb-3 text-[14px] font-dm-sans font-medium uppercase tracking-wide text-secondary-ink">
        Headlines
      </p>

      {state.phase === 'loading' && (
        <Card shadow="none" className="px-5 py-2" data-audit="news-loading">
          {/* animate-pulse is disabled in this project's @theme — scoped keyframe,
              same pattern as MarketsNews's skeleton. */}
          <style>{`@keyframes dlHookPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
          {[0, 1, 2].map(i => (
            <div key={i} className="py-3" style={{ animation: 'dlHookPulse 1.6s ease-in-out infinite' }}>
              <div className="h-4 w-4/5 rounded-lg bg-forest-green/10" />
              <div className="mt-2 h-3 w-2/5 rounded-lg bg-forest-green/10" />
            </div>
          ))}
        </Card>
      )}

      {state.phase === 'error' && (
        <Card shadow="none" className="px-5 py-6 text-center" data-audit="news-error">
          <p className="font-dm-sans text-[16px] text-secondary-ink">
            Headlines are temporarily unavailable.
          </p>
        </Card>
      )}

      {state.phase === 'ready' && shown.length === 0 && (
        <Card shadow="none" className="px-5 py-6 text-center" data-audit="news-empty">
          <p className="font-dm-sans text-[16px] text-secondary-ink">
            No cattle-country headlines right now.
          </p>
        </Card>
      )}

      {state.phase === 'ready' && shown.length > 0 && (
        <Card shadow="none" className="divide-y divide-forest-green/10 px-5 py-1" data-audit="news-list">
          {shown.map(item => (
            <NewsCardCompact key={item.link} item={item} />
          ))}
          {more && (
            <div>
              <button
                onClick={toggle}
                disabled={widening}
                aria-expanded={expanded}
                className="min-h-[48px] w-full py-3 text-left font-dm-sans text-[14px] text-secondary-ink transition-colors hover:text-forest-green disabled:opacity-60"
                data-audit="news-more"
              >
                {widening ? 'Getting more…' : expanded ? 'Fewer headlines ↑' : 'More headlines ↓'}
              </button>
              {wideningFailed && (
                <p className="pb-3 font-dm-sans text-[14px] text-secondary-ink" data-audit="news-more-failed">
                  Couldn’t get more headlines just now. Tap to try again.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function newsUrl(fips: string | null | undefined, limit: number): string {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (fips) qs.set('fips', fips)
  return `/api/news?${qs.toString()}`
}

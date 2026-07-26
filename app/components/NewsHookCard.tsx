'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import {
  NewsCardCompact,
  diversifyLead,
  rankItems,
  type NewsItem,
  type NewsResponse,
} from '@/app/components/MarketsNews'

// The 3-headline news hook — the ENTIRE news surface after the Boring purge
// (North Star v3 §6: news demoted from the default view to a hook inside Today).
// Same /api/news fetch + client-side ranking the old full feed used (imported from
// MarketsNews, which stays parked, not deleted): local tier first with the
// diversified lead, then national, top 3 overall. Each headline links OUT to its
// article — there is deliberately NO "more news" affordance anywhere; Dryline
// stopped being a reader. Honesty states: loading skeleton ≠ error ≠ empty.

type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; items: NewsItem[] }

const HEADLINE_COUNT = 3

export default function NewsHookCard({ fips }: { fips?: string | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  // Promise-chain fetch with a cancelled flag (mirrors BottomTabBar's pattern; no
  // synchronous setState in the effect body). Initial state already shows the
  // skeleton; on a fips change the previous county's headlines hold for the
  // sub-second swap rather than flashing back to skeleton.
  useEffect(() => {
    let cancelled = false
    const qs = fips ? `?fips=${encodeURIComponent(fips)}` : ''
    fetch(`/api/news${qs}`)
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
        // Same reading order as the old feed's page one: ranked local river (with
        // the diversified lead) ahead of the national tail — then just the top 3.
        const ranked = rankItems(data.items ?? [])
        const top = [
          ...diversifyLead(ranked.filter(it => it.regional)),
          ...ranked.filter(it => !it.regional),
        ].slice(0, HEADLINE_COUNT)
        setState({ phase: 'ready', items: top })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' })
      })
    return () => { cancelled = true }
  }, [fips])

  return (
    <div>
      <p className="mb-3 text-xs font-dm-sans font-medium uppercase tracking-wide text-forest-green/40">
        Headlines
      </p>

      {state.phase === 'loading' && (
        <Card shadow="none" className="px-5 py-2">
          {/* animate-pulse is disabled in this project's @theme — scoped keyframe,
              same pattern as MarketsNews's skeleton. */}
          <style>{`@keyframes dlHookPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
          {[0, 1, 2].map(i => (
            <div key={i} className="py-3" style={{ animation: 'dlHookPulse 1.6s ease-in-out infinite' }}>
              <div className="h-4 w-4/5 rounded bg-forest-green/10" />
              <div className="mt-2 h-3 w-2/5 rounded bg-forest-green/10" />
            </div>
          ))}
        </Card>
      )}

      {state.phase === 'error' && (
        <Card shadow="none" className="px-5 py-6 text-center">
          <p className="font-dm-sans text-sm text-forest-green/55">
            Headlines are temporarily unavailable.
          </p>
        </Card>
      )}

      {state.phase === 'ready' && state.items.length === 0 && (
        <Card shadow="none" className="px-5 py-6 text-center">
          <p className="font-dm-sans text-sm text-forest-green/55">
            No cattle-country headlines right now.
          </p>
        </Card>
      )}

      {state.phase === 'ready' && state.items.length > 0 && (
        <Card shadow="none" className="divide-y divide-forest-green/10 px-5 py-1">
          {state.items.map(item => (
            <NewsCardCompact key={item.link} item={item} />
          ))}
        </Card>
      )}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import type { NewsItem, NewsResponse } from '@/lib/news-rank'

// ─── Headlines on Today (Block 16, ruling 1) ──────────────────────────────────
//
// Back on Today as the LAST section, below everything actionable and below the
// strips. Headlines only: a title, the source's name, how old — no images, no
// summaries, no source logos. A tap opens the source. 15b cut the old card for
// pushing the ranch down the page; this one sits where nothing is beneath it.
//
// The route ranks and sends three (7B.1); "More headlines" widens to ten once,
// in place. Loading, unavailable and empty are three different truths and read
// as three different sentences.

type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; items: NewsItem[]; total: number }

const HEADLINE_COUNT = 3
const EXPANDED_COUNT = 10

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

function newsUrl(fips: string | null | undefined, limit: number): string {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (fips) qs.set('fips', fips)
  return `/api/news?${qs.toString()}`
}

export default function TodayHeadlines({ fips }: { fips?: string | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const [widening, setWidening] = useState(false)
  const [wideningFailed, setWideningFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(newsUrl(fips, HEADLINE_COUNT))
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() as Promise<NewsResponse> })
      .then(data => {
        if (cancelled) return
        if (data.error) { setState({ phase: 'error' }); return }
        const items = data.items ?? []
        setState({ phase: 'ready', items, total: data.total ?? items.length })
      })
      .catch(() => { if (!cancelled) setState({ phase: 'error' }) })
    return () => { cancelled = true }
  }, [fips])

  async function toggle() {
    if (state.phase !== 'ready') return
    if (expanded) { setExpanded(false); return }
    if (state.items.length >= Math.min(EXPANDED_COUNT, state.total)) { setExpanded(true); return }
    setWidening(true); setWideningFailed(false)
    try {
      const res = await fetch(newsUrl(fips, EXPANDED_COUNT))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as NewsResponse
      if (data.error) throw new Error('feed error')
      const items = data.items ?? []
      if (items.length < state.items.length) throw new Error('short reply')
      setState({ phase: 'ready', items, total: data.total ?? items.length })
      setExpanded(true)
    } catch {
      setWideningFailed(true)   // the three on screen stay put
    } finally {
      setWidening(false)
    }
  }

  const shown = state.phase === 'ready' ? (expanded ? state.items : state.items.slice(0, HEADLINE_COUNT)) : []
  const more = state.phase === 'ready' && Math.min(state.total, EXPANDED_COUNT) > HEADLINE_COUNT

  return (
    <section aria-labelledby="headlines-h" data-audit="news-hook">
      <p id="headlines-h" className="mb-3 text-[14px] font-dm-sans font-medium uppercase tracking-wide text-secondary-ink">Headlines</p>
      {state.phase === 'loading' && (
        <Card shadow="none" className="px-5 py-2" data-audit="news-loading">
          <style>{`@keyframes dlHeadPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
          {[0, 1, 2].map(i => (
            <div key={i} className="py-3" style={{ animation: 'dlHeadPulse 1.6s ease-in-out infinite' }}>
              <div className="h-4 w-4/5 rounded-lg bg-forest-green/10" />
              <div className="mt-2 h-3 w-2/5 rounded-lg bg-forest-green/10" />
            </div>
          ))}
        </Card>
      )}
      {state.phase === 'error' && (
        <Card shadow="none" className="px-5 py-6 text-center" data-audit="news-error">
          <p className="font-dm-sans text-[16px] text-secondary-ink">Headlines are not available right now.</p>
        </Card>
      )}
      {state.phase === 'ready' && shown.length === 0 && (
        <Card shadow="none" className="px-5 py-6 text-center" data-audit="news-empty">
          <p className="font-dm-sans text-[16px] text-secondary-ink">No cattle-country headlines right now.</p>
        </Card>
      )}
      {state.phase === 'ready' && shown.length > 0 && (
        <Card shadow="none" className="divide-y divide-forest-green/10 px-5 py-1" data-audit="news-list">
          {shown.map(item => (
            <a key={item.link} href={item.link} target="_blank" rel="noopener noreferrer" className="block min-h-[48px] py-3" data-audit="news-row">
              <span className="block font-dm-sans text-[17px] font-semibold leading-snug text-ink">{item.title}</span>
              <span className="mt-1 block font-dm-sans text-[14px] text-secondary-ink">
                {item.source}{item.pubDate && relativeTime(item.pubDate) ? ` · ${relativeTime(item.pubDate)}` : ''}
              </span>
            </a>
          ))}
          {more && (
            <div>
              <button onClick={toggle} disabled={widening} aria-expanded={expanded}
                className="min-h-[48px] w-full py-3 text-left font-dm-sans text-[16px] text-secondary-ink disabled:opacity-60" data-audit="news-more">
                {widening ? 'Getting more…' : expanded ? 'Fewer headlines' : 'More headlines'}
              </button>
              {wideningFailed && (
                <p className="pb-3 font-dm-sans text-[14px] text-secondary-ink" data-audit="news-more-failed">Couldn’t get more just now. Tap to try again.</p>
              )}
            </div>
          )}
        </Card>
      )}
    </section>
  )
}

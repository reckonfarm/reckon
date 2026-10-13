'use client'

import { useState, useRef, useEffect } from 'react'
import { trackEvent } from '@/lib/analytics'
import { US_STATE_NAMES } from '@/lib/news-sources'
import { rememberCounty } from '@/lib/county-cookie'

// County names in the counties table already end in "County" ("Petroleum County"); some
// do not ("Baltimore city"). Say "County" once, never twice.
const countyLabel = (name: string) => /\bcounty$/i.test(name.trim()) ? name.trim() : `${name.trim()} County`

export interface County {
  id: number
  fips: string
  name: string
  state: string
}

interface Props {
  // The currently-selected county, resolved server-side from ?fips=
  selectedCounty?: County | null
  // Route to push fips into — '/dashboard' (default) or '/cattle'. Lets the same
  // selector drive either peer view.
  basePath?: string
  // View to keep across a switch (?view=…); omit for the default Today.
  view?: string
}

// A county switch is a HARD navigation on every platform (flow, commit 4).
// Two reasons, both verified: (1) the iOS standalone WebView silently drops
// the same-route ?fips= router.push (lib/standalone-nav.ts's original case);
// (2) the App Router's prefetch cache: bare /dashboard is a middleware 307 to
// the home county for a signed-in person, and once any prefetch has cached
// that redirect under the /dashboard key, router.push('/dashboard?fips=X')
// is served from it — the switch lands back on the home county with no
// request at all (reproduced in Chromium and WebKit; blocking prefetches
// fixed it). A county change is a real page change; one document load is
// the honest price, and it sidesteps both traps with one code path.
function go(url: string) {
  window.location.assign(url)
}

export default function CountySelector({ selectedCounty, basePath = '/dashboard', view }: Props) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<County[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)

  const inputRef     = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A resolved county here means a dashboard county view — fire once per FIPS.
  useEffect(() => {
    if (selectedCounty?.fips) trackEvent('county_viewed', { fips: selectedCounty.fips })
  }, [selectedCounty?.fips])

  // Debounced fetch — fires 300 ms after the user stops typing
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/counties?search=${encodeURIComponent(trimmed)}`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query])

  function select(county: County) {
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
    rememberCounty(county.fips)   // Block 49: the phone remembers, so Markets and Weather open here next time
    // `view` keeps the caller's view across the switch (the Weather view's
    // selector lands on the new county's Weather, not its Today).
    go(`${basePath}?fips=${county.fips}${view ? `&view=${view}` : ''}`)
  }


  // Close dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  const showResults  = open && results.length > 0
  const showNoMatch  = open && query.trim().length >= 2 && !loading && results.length === 0

  // Phase A2 — two states. RESTING: the county as a statement at ink weight with one
  // verb, "Change" (a faded search input read as disabled). CHOOSING: the search
  // field, results, and a visible Cancel that keeps the current county. With no
  // county chosen yet there is nothing to rest on, so the chooser is simply open.
  const [choosing, setChoosing] = useState(false)
  // Block 49: "Near me" — the county under the phone, from its own position.
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed' | 'denied'>('idle')
  function nearMe() {
    if (!('geolocation' in navigator)) { setLocating('failed'); return }
    setLocating('busy')
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const res = await fetch(`/api/counties?lat=${pos.coords.latitude.toFixed(4)}&lon=${pos.coords.longitude.toFixed(4)}`)
        const data = await res.json()
        const county = Array.isArray(data) ? (data[0] as County | undefined) : undefined
        if (!county) { setLocating('failed'); return }
        select(county)
      } catch { setLocating('failed') }
    }, err => setLocating(err.code === 1 ? 'denied' : 'failed'), { timeout: 10_000, maximumAge: 300_000 })
  }
  const chooserOpen = !selectedCounty || choosing
  function startChoosing() {
    setChoosing(true)
    setQuery('')
    setResults([])
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  function cancel() {
    setChoosing(false)
    setOpen(false)
    setQuery('')
    setResults([])
  }
  const stateName = selectedCounty ? (US_STATE_NAMES[selectedCounty.state] ?? selectedCounty.state) : ''

  if (!chooserOpen && selectedCounty) {
    return (
      <div ref={containerRef} className="w-full" data-audit="county-control">
        <button
          type="button"
          onClick={startChoosing}
          aria-label={`${countyLabel(selectedCounty.name)}, ${stateName}. Change county`}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg px-1 text-left font-dm-sans text-[17px] text-ink hover:bg-forest-green/5"
        >
          <span className="truncate font-semibold">{countyLabel(selectedCounty.name)}, {stateName}</span>
          <span className="shrink-0 font-semibold text-brand underline underline-offset-2">Change</span>
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full" data-audit="county-control" role="search" aria-label="Choose a county">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <label htmlFor="county-search" className="sr-only">Search by county name or state</label>
          <input
            id="county-search"
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => { if (e.key === 'Escape') { if (selectedCounty) cancel(); else { setOpen(false); setQuery('') } } }}
            placeholder="Search by county name or state"
            autoFocus={!!selectedCounty}
            className="w-full min-h-[52px] rounded-lg border border-control-border bg-surface py-3 pl-4 pr-10 font-dm-sans text-[18px] text-ink placeholder:text-secondary-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-dm-sans text-[14px] text-secondary-ink select-none">…</span>
          )}
        </div>
        {selectedCounty && (
          <button type="button" onClick={cancel} className="min-h-[52px] shrink-0 rounded-lg border border-control-border px-4 font-dm-sans text-[17px] font-semibold text-ink hover:bg-forest-green/5" data-audit="county-cancel">
            Cancel
          </button>
        )}
      </div>
      {/* Results */}
      {showResults && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-control-border bg-surface shadow-overlay divide-y divide-rule" aria-label="Matching counties">
          {results.map(county => (
            <li key={county.fips}>
              <button
                className="flex min-h-[48px] w-full items-center px-4 py-2.5 text-left hover:bg-cream transition-colors"
                onMouseDown={e => { e.preventDefault(); select(county) }}
              >
                <span className="flex-1 truncate font-dm-sans text-[17px] font-medium text-ink">{countyLabel(county.name)}</span>
                <span className="ml-3 shrink-0 font-dm-sans text-[16px] text-secondary-ink">{US_STATE_NAMES[county.state] ?? county.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={nearMe} disabled={locating === 'busy'} className="mt-2 inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-control-border px-4 font-dm-sans text-[16px] font-semibold text-ink hover:bg-forest-green/5 disabled:opacity-60" data-audit="county-near-me">
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
        {locating === 'busy' ? 'Finding your county…' : 'Near me'}
      </button>
      {locating === 'denied' && <p className="mt-1 font-dm-sans text-[15px] text-ink">Location is off for this site. Search by name above.</p>}
      {locating === 'failed' && <p className="mt-1 font-dm-sans text-[15px] text-ink">Couldn&rsquo;t find a county from here. Search by name above.</p>}
      {/* No match */}
      {showNoMatch && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-control-border bg-surface px-4 py-3 shadow-overlay">
          <p className="font-dm-sans text-[16px] text-secondary-ink">No counties match &ldquo;{query}&rdquo;</p>
        </div>
      )}
    </div>
  )
}

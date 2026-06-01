'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { trackEvent } from '@/lib/analytics'

export interface County {
  id: number
  fips: string
  name: string
  state: string
}

interface Props {
  // The currently-selected county, resolved server-side from ?fips=
  selectedCounty?: County | null
}

export default function CountySelector({ selectedCounty }: Props) {
  const router = useRouter()
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
    router.push(`/dashboard?fips=${county.fips}`)
  }

  function clear() {
    setQuery('')
    setResults([])
    router.push('/dashboard')
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

  return (
    <div ref={containerRef} className="relative w-full max-w-lg">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQuery('') } }}
          placeholder={
            selectedCounty
              ? `${selectedCounty.name}, ${selectedCounty.state}`
              : 'Search by county name, state, or FIPS…'
          }
          className="w-full rounded-lg border border-forest-green/20 bg-white py-3 pl-4 pr-10 text-sm font-dm-sans text-forest-green placeholder:text-forest-green/50 focus:border-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/20 transition-colors"
        />

        {/* Loading dots */}
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-forest-green/30 font-dm-sans select-none">
            …
          </span>
        )}

        {/* Clear button */}
        {selectedCounty && !query && !loading && (
          <button
            onClick={clear}
            aria-label="Clear selection"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-forest-green/40 hover:text-rust transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showResults && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-forest-green/20 bg-white shadow-lg divide-y divide-forest-green/5">
          {results.map(county => (
            <li key={county.fips}>
              <button
                className="flex w-full items-center px-4 py-2.5 text-left hover:bg-cream transition-colors"
                onMouseDown={e => { e.preventDefault(); select(county) }}
              >
                <span className="flex-1 truncate text-sm font-medium text-forest-green font-dm-sans">
                  {county.name}
                </span>
                <span className="ml-3 shrink-0 text-xs font-medium text-forest-green/60 font-dm-sans">
                  {county.state}
                </span>
                <span className="ml-2 shrink-0 text-xs text-forest-green/30 font-dm-sans">
                  {county.fips}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* No match */}
      {showNoMatch && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 shadow-lg">
          <p className="text-sm text-forest-green/50 font-dm-sans">
            No counties match &ldquo;{query}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}

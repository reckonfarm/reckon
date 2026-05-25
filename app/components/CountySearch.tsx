'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface County {
  id: number
  fips: string
  name: string
  state: string
}

export default function CountySearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<County[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    timerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/counties?search=${encodeURIComponent(query.trim())}`)
      if (res.ok) {
        const data: County[] = await res.json()
        setResults(data)
        setOpen(data.length > 0)
        setActiveIdx(-1)
      }
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query])

  function select(county: County) {
    router.push(`/dashboard?fips=${county.fips}`)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      select(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search county — e.g. Lincoln, NE"
        aria-label="Search for a county"
        aria-autocomplete="list"
        aria-expanded={open}
        className="w-full rounded-xl border border-forest-green/20 bg-white px-4 py-3 text-sm font-dm-sans text-forest-green placeholder-forest-green/40 shadow-sm focus:outline-none focus:ring-2 focus:ring-forest-green/30"
      />
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-forest-green/15 bg-white shadow-lg"
        >
          {results.map((county, i) => (
            <li key={county.fips} role="option" aria-selected={i === activeIdx}>
              <button
                onMouseDown={() => select(county)}
                className={[
                  'w-full px-4 py-2.5 text-left text-sm font-dm-sans',
                  i === activeIdx
                    ? 'bg-forest-green text-white'
                    : 'text-forest-green hover:bg-cream',
                ].join(' ')}
              >
                {county.name}, {county.state}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

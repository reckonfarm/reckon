'use client'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/app/components/ui/Field'
import { RANCH_NAME_MAX } from '@/lib/ranch-membership'

interface County { id: number; fips: string; name: string; state: string }

// The name, the county, one button. The county search is the same /api/counties
// read the public county page uses; picking one here sets it, it does not
// navigate. On success the page hard-navigates to Today: the ranch is
// server-resolved from the new membership, and the installed PWA drops client
// navigations (the invite landing's precedent).
export default function SetupForm() {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<County[]>([])
  const [county, setCounty] = useState<County | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!query.trim() || county) { setResults([]); return }
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/counties?search=${encodeURIComponent(query.trim())}`).catch(() => null)
      if (res?.ok) setResults((await res.json()) as County[])
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query, county])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, county_fips: county?.fips ?? null }) })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) { setError(json.error ?? 'Could not set up the ranch.'); setBusy(false); return }
      window.location.assign('/today')
    } catch {
      setError('No signal — try again when you have one.'); setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5" data-audit="setup-form">
      <label className="block font-dm-sans text-[16px] font-medium text-ink">Ranch name
        <Input value={name} onChange={e => setName(e.target.value)} maxLength={RANCH_NAME_MAX} autoFocus placeholder="Dry Creek Ranch" data-audit="setup-name" />
      </label>
      <div className="relative">
        <label className="block font-dm-sans text-[16px] font-medium text-ink">County
          {county ? (
            <div className="mt-1 flex min-h-[48px] items-center justify-between rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] text-ink" data-audit="setup-county">
              <span>{county.name}, {county.state}</span>
              <button type="button" onClick={() => { setCounty(null); setQuery('') }} className="min-h-[48px] px-2 font-semibold text-forest-green underline underline-offset-2">Change</button>
            </div>
          ) : (
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Fergus, MT" aria-autocomplete="list" aria-expanded={results.length > 0} data-audit="setup-county-search" />
          )}
        </label>
        {!county && results.length > 0 && (
          <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-forest-green/15 bg-white" data-audit="setup-county-results">
            {results.map(c => (
              <li key={c.fips} role="option" aria-selected={false}>
                <button type="button" onMouseDown={() => { setCounty(c); setResults([]) }} className="min-h-[48px] w-full px-4 text-left font-dm-sans text-[16px] text-forest-green hover:bg-cream" data-audit="setup-county-option" data-fips={c.fips}>{c.name}, {c.state}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="font-dm-sans text-[16px] font-semibold text-rust" data-audit="setup-error">{error}</p>}
      <button type="submit" disabled={busy || !name.trim()} className="min-h-[56px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="setup-save">
        {busy ? 'Setting up…' : 'Set up my ranch'}
      </button>
    </form>
  )
}

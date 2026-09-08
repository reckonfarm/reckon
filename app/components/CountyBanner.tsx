'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'

// ─── The first-visit banner on a public county page (Block 6B) ────────────────
// Short, above the fold, and gone after one tap: the county data stays first
// and no sales page stands in front of it. Two actions only. The dismissal is
// a public preference on this browser, not private state.
const KEY = 'dryline_county_banner_seen'
const listeners = new Set<() => void>()
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export default function CountyBanner() {
  const seen = useSyncExternalStore(subscribe, read, () => true)   // server: assume seen, so the banner never flashes for a returning reader
  if (seen) return null
  const dismiss = () => { try { localStorage.setItem(KEY, '1') } catch { /* private mode */ } for (const l of listeners) l() }
  return (
    <aside className="mb-5 rounded-xl border border-forest-green/15 bg-forest-green/[0.04] px-4 py-3 sm:px-5" aria-label="About Dryline" data-audit="county-banner">
      <p className="font-fraunces text-[20px] font-semibold leading-tight text-forest-green">Your ranch, on the record.</p>
      <p className="mt-1 font-dm-sans text-[16px] text-ink">Keep feed, cattle work, rain and crew updates together.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/signin?mode=signup&pilot=winter" className="inline-flex min-h-[48px] items-center rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream hover:bg-forest-green/90" data-audit="banner-start">Start your ranch record</Link>
        <button type="button" onClick={dismiss} className="inline-flex min-h-[48px] items-center rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5" data-audit="banner-explore">Explore county information</button>
      </div>
    </aside>
  )
}

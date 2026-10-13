'use client'

import { openSignInSheet } from '@/lib/sign-in-sheet'

// ─── LockedTeaser (Block 49) ─────────────────────────────────────────────────
// On a public page, the one component that stands where a personal piece
// would go — "Your bunches priced here", "Weather at your places". A lock, the
// words, one tap opens the sign-in sheet (R1: the ask comes only at the edge
// of something private). The same component everywhere, never a one-off.
export default function LockedTeaser({ label, returnTo, audit = 'locked-teaser' }: { label: string; returnTo?: string; audit?: string }) {
  return (
    <button
      type="button"
      onClick={() => openSignInSheet({ returnTo })}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-dashed border-forest-green/30 bg-white px-4 py-3 text-left hover:bg-forest-green/[0.03]"
      data-audit={audit}
    >
      <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-forest-green">
        <rect x="4" y="10.5" width="16" height="10" rx="2" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </svg>
      <span className="font-dm-sans text-[17px] font-semibold text-ink">{label}</span>
      <span aria-hidden className="ml-auto shrink-0 font-dm-sans text-[16px] font-semibold text-brand">Sign in</span>
    </button>
  )
}

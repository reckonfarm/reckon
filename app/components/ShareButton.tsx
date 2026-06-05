'use client'

import { useState } from 'react'
import { trackEvent } from '@/lib/analytics'

// Pass-it-to-a-neighbor share. PRODUCT RULE: the payload carries ONLY the app +
// the county's public drought status. NEVER LFP/payment estimates, cattle
// earnings, head counts, or any personal/financial data — ranchers don't
// broadcast what they make, and leaking it would break trust. Drought is public.
//
// Native Web Share (system sheet → texts, etc.) on mobile; copy-to-clipboard
// fallback on desktop. User-cancelled share is silent. referral_shared fires
// only on actual success, with the surface only (no fips/PII).

export default function ShareButton({
  fips,
  countyLabel,
  droughtLabel,
  surface,
}: {
  fips?: string | null            // omit/null → neutral national payload (no county/drought)
  countyLabel?: string | null
  droughtLabel?: string | null    // "D2 (severe drought)" when in drought, else null
  surface: 'dashboard' | 'cattle'
}) {
  const [copied, setCopied] = useState(false)

  // Drought-intent share → open the Drought view explicitly (the dashboard now
  // defaults to Market News). No-fips fallback → the Markets home (the old /cattle
  // page is gone). NEVER a county/drought we don't have.
  const url = fips ? `https://dryline.farm/dashboard?fips=${fips}&view=drought` : 'https://dryline.farm/'
  const text = !fips
    ? `Check U.S. cattle & hay prices and your county's drought on Dryline.`
    : droughtLabel && countyLabel
      ? `${countyLabel} is in ${droughtLabel}. Check your county's drought, LFP eligibility, and local hay & cattle prices on Dryline.`
      : `Check your county's drought, LFP eligibility, and hay & cattle prices on Dryline.`

  async function onShare() {
    const data: ShareData = { title: 'Dryline', text, url }

    // Native share sheet (mobile). Resolves on send, rejects AbortError on cancel.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(data)
        trackEvent('referral_shared', { surface })
        return
      } catch (err) {
        // Cancelled → do nothing. Any other failure → fall through to copy.
        if ((err as Error)?.name === 'AbortError') return
      }
    }

    // Copy-to-clipboard fallback (desktop).
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      trackEvent('referral_shared', { surface })
    } catch {
      /* clipboard blocked — nothing more we can safely do */
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="Share Dryline"
      className="inline-flex items-center gap-1.5 rounded-lg border border-forest-green/15 px-3 py-1.5 font-dm-sans text-sm font-medium text-forest-green/70 transition-colors hover:bg-forest-green/5 hover:text-forest-green"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v13" />
        <path d="M8 7l4-4 4 4" />
        <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </svg>
      {copied ? 'Link copied' : 'Share'}
    </button>
  )
}

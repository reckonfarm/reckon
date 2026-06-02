'use client'

import { useEffect, useState } from 'react'

// Dismissible nudge shown ONLY inside embedded/in-app browsers (Facebook/Instagram/
// etc. WKWebView), which use isolated, often-ephemeral cookie jars — so a session
// signed in there may not survive to the next visit. We can't fix another app's
// cookie store, so we steer users to a persistent context: real Safari, or the
// PWA home-screen app (we already ship the manifest + icon). Purely additive — it
// touches no auth logic and never renders in normal Safari/Chrome or the installed app.

// Known in-app browser UA signatures (isolated cookie jars). iOS Safari and the
// Messages link sheet share Safari's UA and can't be told apart, so we deliberately
// DON'T flag those (avoids false positives nagging real Safari users).
const IN_APP_UA = /(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|GSA\/|Twitter|Snapchat|Pinterest|musical_ly|TikTok|; wv\))/i

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

const DISMISS_KEY = 'dryline_iab_dismissed'

export default function InAppBrowserBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return
    } catch { /* sessionStorage unavailable */ }
    if (isStandalone()) return // already in the durable home-screen context
    if (IN_APP_UA.test(navigator.userAgent)) setShow(true)
  }, [])

  function dismiss() {
    setShow(false)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  if (!show) return null

  return (
    <div className="sticky top-0 z-50 border-b border-rust/20 bg-rust/[0.06] px-4 py-2.5">
      <div className="mx-auto flex max-w-2xl items-start gap-3">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-rust" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <p className="flex-1 font-dm-sans text-xs leading-relaxed text-forest-green">
          <span className="font-semibold">To stay signed in,</span> open Dryline in Safari — tap the
          <span className="font-medium"> ••• / share icon</span> and choose <span className="font-medium">Open in Browser</span>,
          or <span className="font-medium">Add to Home Screen</span> for an app that keeps you logged in.
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 flex-shrink-0 rounded p-1 text-forest-green/50 hover:text-forest-green"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

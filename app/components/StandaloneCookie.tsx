'use client'

import { useEffect } from 'react'

// Session 1 (2): a phone that opens Dryline from its home screen says so with
// one cookie, so the server never paints "Put Dryline on your home screen" to
// a phone that already did — and never has to guess from the browser.
export default function StandaloneCookie() {
  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) document.cookie = 'dl_installed=1; path=/; max-age=31536000; samesite=lax'
  }, [])
  return null
}

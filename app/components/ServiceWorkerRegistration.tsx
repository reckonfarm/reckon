'use client'

import { useEffect } from 'react'

// ─── The app shell (Block 15, ruling 1) ───────────────────────────────────────
// Registers public/sw.js once the page is up. The worker caches the build's
// static files and the last Today page, so a phone with no signal still opens
// the app — the record sheet, the outbox and the bunch list on the phone all
// live in that shell. It does nothing on a browser without service workers,
// and nothing in development, where the worker would only cache stale builds.
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return
    const t = setTimeout(() => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* the app works without it; it just needs signal to open */ }) }, 500)
    return () => clearTimeout(t)
  }, [])
  return null
}

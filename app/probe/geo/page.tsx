'use client'

import { useCallback, useRef, useState } from 'react'

// ─── 8.0 — the phone probe. THROWAWAY. ────────────────────────────────────────
//
// Not a product surface. No nav link, no auth, no database, no route handler.
// It exists so the phone profile for Block 8 is tuned against PK's iPhone on
// PK's ground instead of a spec sheet, and it is meant to be deleted:
//
//     rm -rf app/probe
//
// It writes NOTHING anywhere. Every reading lives in this tab's memory until
// the tab closes, and the only way anything leaves is the Copy button, which
// puts a text sheet on the clipboard for PK to paste back. That is deliberate:
// a page that recorded a ride to a server would be the person-tracking record
// 8.6 says this work must never create, and a throwaway is exactly the wrong
// place to make an exception.
//
// What it answers, in the order Block 8 needs it:
//   1. watchPosition ACCURACY distribution — what "±N m" actually means here
//   2. FIX INTERVAL — how often a fix really arrives, and the worst gap
//   3. WAKE LOCK — does navigator.wakeLock exist, is it granted, and does it
//      SURVIVE the screen going off (8.4 hangs on this)
//   4. STANDALONE vs Safari — the installed app and the browser can differ
//
// Ride it for a couple of minutes, lock the screen for part of it, then Copy.

interface Fix { t: number; acc: number; lat: number; lng: number; speed: number | null }

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—')
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
// Metres between two fixes, flat-earth — the same projection lib/jobs/boundary
// uses, so the distance here is the distance the real code would compute.
function metres(a: Fix, b: Fix): number {
  const mPerLat = 111_132, mPerLng = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const dx = (b.lng - a.lng) * mPerLng, dy = (b.lat - a.lat) * mPerLat
  return Math.hypot(dx, dy)
}

export default function GeoProbe() {
  const [running, setRunning] = useState(false)
  const [fixes, setFixes] = useState<Fix[]>([])
  const [wake, setWake] = useState<string>('not requested')
  const [notes, setNotes] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const watchRef = useRef<number | null>(null)
  const sentinelRef = useRef<{ release: () => Promise<void> } | null>(null)

  const note = useCallback((s: string) => {
    setNotes(n => [...n, `${new Date().toLocaleTimeString('en-US', { hour12: false })} ${s}`])
  }, [])

  const env = () => {
    if (typeof window === 'undefined') return {} as Record<string, string>
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true
    return {
      surface: standalone ? 'PWA standalone (home screen)' : 'browser tab (Safari)',
      wakeLockApi: 'wakeLock' in navigator ? 'present' : 'ABSENT',
      geolocation: 'geolocation' in navigator ? 'present' : 'ABSENT',
      ua: navigator.userAgent,
    }
  }

  async function start() {
    setErr(null); setCopied(false); setFixes([]); setNotes([])
    note(`start · ${env().surface} · wakeLock API ${env().wakeLockApi}`)

    // Wake Lock, and — the part that matters — whether it SURVIVES screen-off.
    // iOS releases the sentinel when the page is hidden; the honest test is
    // whether it comes back and whether fixes continued in between.
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } }
      if (nav.wakeLock) {
        const s = await nav.wakeLock.request('screen')
        sentinelRef.current = s
        setWake('held')
        note('wake lock GRANTED')
        s.addEventListener('release', () => { setWake('released'); note('wake lock RELEASED (screen off, or the tab was hidden)') })
      } else {
        setWake('unsupported')
        note('wake lock UNSUPPORTED on this browser')
      }
    } catch (e) {
      setWake('refused')
      note(`wake lock REFUSED: ${e instanceof Error ? e.message : String(e)}`)
    }

    document.addEventListener('visibilitychange', onVis)

    if (!navigator.geolocation) { setErr('No geolocation on this browser.'); return }
    watchRef.current = navigator.geolocation.watchPosition(
      p => {
        setFixes(f => [...f, { t: Date.now(), acc: p.coords.accuracy, lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed }])
      },
      e => { note(`position error: ${e.message}`); setErr(e.message) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
    setRunning(true)
  }

  function onVis() {
    note(document.visibilityState === 'hidden' ? 'page HIDDEN (screen locked or app backgrounded)' : 'page VISIBLE again')
    // Re-request on return: iOS drops the sentinel on hide, and 8.4 needs to
    // know whether taking it back works or whether the ride just stops.
    if (document.visibilityState === 'visible' && sentinelRef.current === null) void 0
  }

  async function stop() {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    document.removeEventListener('visibilitychange', onVis)
    try { await sentinelRef.current?.release() } catch { /* already gone */ }
    sentinelRef.current = null
    setRunning(false)
    note('stop')
  }

  // ── the sheet ───────────────────────────────────────────────────────────────
  const accs = fixes.map(f => f.acc)
  const gaps: number[] = []
  let dist = 0
  for (let i = 1; i < fixes.length; i++) { gaps.push((fixes[i].t - fixes[i - 1].t) / 1000); dist += metres(fixes[i - 1], fixes[i]) }
  const worstGap = gaps.length ? Math.max(...gaps) : NaN
  // Everything below is derived from the fixes themselves, so the sheet is a
  // pure function of state — no clock read during render, which is both the
  // repo's lint rule and the reason two renders never disagree about elapsed.
  const elapsed = fixes.length > 1 ? (fixes[fixes.length - 1].t - fixes[0].t) / 1000 : 0

  const sheet = () => {
    const e = env()
    const buckets = [3, 5, 10, 20, 50].map(b => `≤${b}m ${accs.filter(a => a <= b).length}`).join(' · ')
    return [
      'DRYLINE 8.0 PHONE PROBE',
      `when            ${fixes.length ? new Date(fixes[0].t).toISOString() : 'no fixes yet'}`,
      `surface         ${e.surface}`,
      `wakeLock API    ${e.wakeLockApi}`,
      `wakeLock result ${wake}`,
      `ua              ${e.ua}`,
      '',
      `fixes           ${fixes.length} over ${fmt(elapsed, 0)} s`,
      `distance        ${fmt(dist, 0)} m (straight-line sum, flat-earth)`,
      '',
      'ACCURACY (m)',
      `  best ${fmt(Math.min(...accs))} · median ${fmt(pct(accs, 50))} · p90 ${fmt(pct(accs, 90))} · worst ${fmt(Math.max(...accs))}`,
      `  ${buckets}`,
      '',
      'FIX INTERVAL (s)',
      `  median ${fmt(pct(gaps, 50), 2)} · p90 ${fmt(pct(gaps, 90), 2)} · worst ${fmt(worstGap, 1)}`,
      '',
      'EVENTS',
      ...notes.map(n => `  ${n}`),
    ].join('\n')
  }

  async function copy() {
    try { await navigator.clipboard.writeText(sheet()); setCopied(true) } catch { setErr('Copy failed — select the text below instead.') }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 font-dm-sans">
      <p className="text-[14px] font-semibold uppercase tracking-wide text-secondary-ink">Block 8.0 · throwaway probe</p>
      <h1 className="mt-1 font-fraunces text-2xl font-semibold text-ink">Phone GPS &amp; wake lock</h1>
      <p className="mt-2 text-[16px] leading-snug text-secondary-ink">
        Nothing is saved anywhere. Every reading stays in this tab until you close it — the only way
        anything leaves is the Copy button. Ride for a couple of minutes, lock the screen for part of
        it, unlock, then Stop and Copy.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {!running
          ? <button type="button" onClick={() => void start()} className="min-h-[52px] rounded-lg bg-forest-green px-5 text-[17px] font-semibold text-cream">Start</button>
          : <button type="button" onClick={() => void stop()} className="min-h-[52px] rounded-lg bg-rust px-5 text-[17px] font-semibold text-cream">Stop</button>}
        <button type="button" disabled={fixes.length === 0} onClick={() => void copy()} className="min-h-[52px] rounded-lg border border-control-border px-5 text-[17px] font-semibold text-ink disabled:opacity-50">
          {copied ? 'Copied' : 'Copy sheet'}
        </button>
      </div>

      {err && <p role="alert" className="mt-3 text-[16px] font-semibold text-rust">{err}</p>}

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-[16px]">
        <dt className="text-secondary-ink">Fixes</dt><dd className="tabular-nums text-ink">{fixes.length}</dd>
        <dt className="text-secondary-ink">Now</dt><dd className="tabular-nums text-ink">{fixes.length ? `±${fmt(fixes[fixes.length - 1].acc)} m` : '—'}</dd>
        <dt className="text-secondary-ink">Median accuracy</dt><dd className="tabular-nums text-ink">{accs.length ? `±${fmt(pct(accs, 50))} m` : '—'}</dd>
        <dt className="text-secondary-ink">Median interval</dt><dd className="tabular-nums text-ink">{gaps.length ? `${fmt(pct(gaps, 50), 2)} s` : '—'}</dd>
        <dt className="text-secondary-ink">Worst gap</dt><dd className="tabular-nums text-ink">{gaps.length ? `${fmt(worstGap, 1)} s` : '—'}</dd>
        <dt className="text-secondary-ink">Distance</dt><dd className="tabular-nums text-ink">{fmt(dist, 0)} m</dd>
        <dt className="text-secondary-ink">Wake lock</dt><dd className="text-ink">{wake}</dd>
      </dl>

      <pre className="mt-5 overflow-x-auto whitespace-pre-wrap rounded-lg border border-rule bg-surface p-3 text-[14px] leading-snug text-ink">{sheet()}</pre>

      <p className="mt-4 text-[15px] text-secondary-ink">Delete this page when Block 8 is tuned: <code>rm -rf app/probe</code></p>
    </main>
  )
}

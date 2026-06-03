'use client'

// TAPDEBUG — temporary on-device diagnostic overlay for the iOS county-tap bug.
// Arms only when the URL has ?debug=tap (then persists for the tab via
// sessionStorage so it survives the navigation we're observing). The panel is
// pointer-events:none so it can NEVER intercept a tap — it cannot become the
// very overlay bug we're hunting. Remove this component + lib/tapdebug.ts once
// the cause is found.
import { useEffect, useState } from 'react'
import { dbg, getLog, subscribe } from '@/lib/tapdebug'

export default function TapDebug() {
  const [on, setOn] = useState(false)
  const [, force] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('debug') === 'tap') sessionStorage.setItem('tapdebug', '1')
    setOn(sessionStorage.getItem('tapdebug') === '1')
  }, [])

  useEffect(() => {
    if (!on) return
    const unsub = subscribe(() => force(n => n + 1))

    const describe = (e: Event) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName ?? '?'
      const btn = t?.closest?.('button, a, [role="option"]') as HTMLElement | null
      const label = (btn?.textContent ?? t?.textContent ?? '')
        .trim().replace(/\s+/g, ' ').slice(0, 24)
      const p = e as PointerEvent
      const xy = typeof p.clientX === 'number' ? ` @${p.clientX | 0},${p.clientY | 0}` : ''
      return `${e.type} <${tag}>${btn ? '[in-btn]' : ''} "${label}"${xy}`
    }

    const types = [
      'pointerdown', 'pointerup', 'pointercancel',
      'click', 'touchstart', 'touchend', 'touchcancel',
    ]
    const onEvt = (e: Event) => dbg('DOC ' + describe(e))
    // Capture phase: we see the event even if something stops propagation.
    types.forEach(ty => document.addEventListener(ty, onEvt, true))

    const vv = window.visualViewport
    const onVV = () => dbg(`viewport h=${Math.round(vv?.height ?? 0)} (keyboard show/hide)`)
    vv?.addEventListener('resize', onVV)

    const onNav = () => dbg('window: pagehide (hard nav / unload)')
    window.addEventListener('pagehide', onNav)

    dbg('── TapDebug armed @ ' + window.location.pathname + window.location.search)

    return () => {
      types.forEach(ty => document.removeEventListener(ty, onEvt, true))
      vv?.removeEventListener('resize', onVV)
      window.removeEventListener('pagehide', onNav)
      unsub()
    }
  }, [on])

  if (!on) return null

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647,
        maxHeight: '46vh', overflow: 'hidden', pointerEvents: 'none',
        background: 'rgba(0,0,0,0.82)', color: '#16ff6a',
        font: '12px/1.35 ui-monospace, Menlo, monospace',
        padding: '6px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      <div style={{ color: '#ffd166', marginBottom: 2 }}>
        TAPDEBUG · screenshot &amp; send · reload page to clear
      </div>
      {getLog().slice(-26).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}

'use client'

// TAPDEBUG v2 — temporary on-device diagnostic overlay for the iOS county-search
// bug. Arms only when the URL has ?debug=tap (then persists for the tab via
// sessionStorage so it survives the navigation we're observing). The panel is
// pointer-events:none so it can NEVER intercept a tap.
//
// v2 changes after the first on-device capture:
//  - keyboard-aware: shrinks to a short strip ABOVE the input when the keyboard
//    is up (the dashboard selector lives at the top of the page), so it stops
//    covering the input + suggestion dropdown we're trying to observe.
//  - only logs DOC pointerdown/pointercancel (not the 4x tap-event spam) so the
//    high-value lines stop scrolling off.
// Remove this component + lib/tapdebug.ts once the cause is found.
import { useEffect, useState } from 'react'
import { dbg, getLog, subscribe } from '@/lib/tapdebug'

export default function TapDebug() {
  const [on, setOn] = useState(false)
  const [, force] = useState(0)
  const [kbUp, setKbUp] = useState(false)

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

    // pointerdown = where the finger lands; mousedown = the SYNTHESIZED iOS
    // event that actually drives the reverted onMouseDown selection handler
    // (and shows which element it targets); pointercancel = iOS canceling the
    // gesture (e.g. dropdown unmounts mid-tap).
    const types = ['pointerdown', 'mousedown', 'pointercancel']
    const onEvt = (e: Event) => dbg('DOC ' + describe(e))
    types.forEach(ty => document.addEventListener(ty, onEvt, true))

    const vv = window.visualViewport
    const onVV = () => {
      const h = vv?.height ?? window.innerHeight
      const up = h < window.innerHeight * 0.8
      setKbUp(up)
      dbg(`viewport h=${Math.round(h)} ${up ? '(keyboard UP)' : '(keyboard down)'}`)
    }
    vv?.addEventListener('resize', onVV)

    const onHide = () => dbg('window: pagehide (hard nav / unload)')
    window.addEventListener('pagehide', onHide)

    dbg('── TAPDEBUG v2 armed @ ' + window.location.pathname + window.location.search)

    return () => {
      types.forEach(ty => document.removeEventListener(ty, onEvt, true))
      vv?.removeEventListener('resize', onVV)
      window.removeEventListener('pagehide', onHide)
      unsub()
    }
  }, [on])

  if (!on) return null

  // When the keyboard is up, keep the panel short and above the input (~y147)
  // so it never covers the selector or its dropdown. When the keyboard is down,
  // expand it so a single screenshot captures the full chain.
  const maxLines = kbUp ? 6 : 30

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647,
        maxHeight: kbUp ? '116px' : '52vh', overflow: 'hidden', pointerEvents: 'none',
        background: 'rgba(0,0,0,0.85)', color: '#16ff6a',
        font: '12px/1.32 ui-monospace, Menlo, monospace',
        padding: '5px 7px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      <div style={{ color: '#ffd166', marginBottom: 2 }}>
        {kbUp
          ? 'TAPDEBUG v2 · keyboard up (short) · dismiss kbd to see full log'
          : 'TAPDEBUG v2 · screenshot & send · reload page to clear'}
      </div>
      {getLog().slice(-maxLines).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}

'use client'

import { useEffect } from 'react'

// ─── Never lose your place (Block 15, ruling 7) ──────────────────────────────
// A save that lands back on a list arrives with the row's id in the hash. The
// row is scrolled into view and lit for a moment, then the hash is cleared so
// a reload does not do it again.
export default function LitOnHash({ prefix }: { prefix: string }) {
  useEffect(() => {
    const run = () => {
      const h = window.location.hash.slice(1)
      if (!h.startsWith(prefix)) return
      const el = document.getElementById(h)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('ring-2', 'ring-forest-green', 'rounded-lg')
      el.setAttribute('data-lit', 'true')
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setTimeout(() => { el.classList.remove('ring-2', 'ring-forest-green'); el.removeAttribute('data-lit') }, 2_500)
    }
    run()
    window.addEventListener('hashchange', run)
    return () => window.removeEventListener('hashchange', run)
  }, [prefix])
  return null
}

'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// Fixed reserved height for the preview map (px). Held constant before, during,
// and after mount so there is no layout shift.
const MAP_HEIGHT = 460

// Reuse the existing drought-overlay map (same /api/usdm fetch, same USDM
// palette) — no fork. Loaded lazily, client-only.
const HayMap = dynamic(() => import('@/app/hay/map/HayMapClient'), {
  ssr: false,
  loading: () => (
    <div
      className="flex w-full items-center justify-center bg-forest-green/5"
      style={{ height: MAP_HEIGHT }}
    >
      <p className="font-dm-sans text-sm text-forest-green/50">Loading map…</p>
    </div>
  ),
})

// Framed preview centered on Montana / the core service region at a fixed zoom.
// The map only mounts once scrolled into view (IntersectionObserver) so it adds
// nothing to the initial homepage load. Pan/zoom are disabled, so a scroll
// gesture scrolls the page — not the map — on mobile and desktop alike.
export default function HomeDroughtMap() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setShow(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <figure className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-forest-green/10 bg-cream shadow-sm">
      {/* Reserved height prevents layout shift before/while the map mounts. */}
      <div ref={ref} style={{ height: MAP_HEIGHT }}>
        {show ? (
          <HayMap
            listings={[]}
            center={[47, -109]}
            zoom={5}
            height={`${MAP_HEIGHT}px`}
            interactive={false}
            showLegend={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-forest-green/5">
            <p className="font-dm-sans text-sm text-forest-green/50">Drought map</p>
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 border-t border-forest-green/10 px-4 py-2.5">
        <span className="font-dm-sans text-xs text-forest-green/50">
          U.S. Drought Monitor — Current Conditions
        </span>
        <Link
          href="/hay/map"
          className="flex-shrink-0 font-dm-sans text-xs font-medium text-rust hover:text-rust/70 transition-colors"
        >
          Explore the full map →
        </Link>
      </figcaption>
    </figure>
  )
}

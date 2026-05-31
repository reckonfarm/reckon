'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// Fixed reserved height for the preview map (px). Held constant before, during,
// and after mount so there is no layout shift.
const MAP_HEIGHT = 460

// Default frame — north-central Montana / the core service region — used when we
// don't know the visitor's state.
const DEFAULT_CENTER: [number, number] = [47, -109]
const DEFAULT_ZOOM = 5

// Approximate geographic center + a state-level zoom per state, so the preview
// opens framed on the visitor's region. Derived server-side from the request
// (visitorState) — no browser geolocation, no permission popup.
const STATE_VIEW: Record<string, { center: [number, number]; zoom: number }> = {
  AL: { center: [32.8, -86.8], zoom: 6 }, AK: { center: [63.5, -152.0], zoom: 4 },
  AZ: { center: [34.2, -111.9], zoom: 6 }, AR: { center: [34.8, -92.4], zoom: 6 },
  CA: { center: [37.2, -119.3], zoom: 5 }, CO: { center: [39.0, -105.5], zoom: 6 },
  CT: { center: [41.6, -72.7], zoom: 8 }, DE: { center: [39.0, -75.5], zoom: 8 },
  DC: { center: [38.9, -77.0], zoom: 9 }, FL: { center: [28.6, -82.4], zoom: 6 },
  GA: { center: [32.6, -83.4], zoom: 6 }, HI: { center: [20.6, -157.0], zoom: 6 },
  ID: { center: [44.4, -114.6], zoom: 5 }, IL: { center: [40.0, -89.2], zoom: 6 },
  IN: { center: [39.9, -86.3], zoom: 6 }, IA: { center: [42.0, -93.5], zoom: 6 },
  KS: { center: [38.5, -98.4], zoom: 6 }, KY: { center: [37.5, -85.3], zoom: 6 },
  LA: { center: [31.0, -92.0], zoom: 6 }, ME: { center: [45.4, -69.2], zoom: 6 },
  MD: { center: [39.0, -76.8], zoom: 7 }, MA: { center: [42.3, -71.8], zoom: 8 },
  MI: { center: [44.3, -85.4], zoom: 6 }, MN: { center: [46.3, -94.3], zoom: 6 },
  MS: { center: [32.7, -89.7], zoom: 6 }, MO: { center: [38.4, -92.5], zoom: 6 },
  MT: { center: [47.0, -109.6], zoom: 6 }, NE: { center: [41.5, -99.8], zoom: 6 },
  NV: { center: [39.3, -116.6], zoom: 6 }, NH: { center: [43.7, -71.6], zoom: 7 },
  NJ: { center: [40.2, -74.7], zoom: 7 }, NM: { center: [34.4, -106.1], zoom: 6 },
  NY: { center: [42.9, -75.5], zoom: 6 }, NC: { center: [35.5, -79.4], zoom: 6 },
  ND: { center: [47.5, -100.5], zoom: 6 }, OH: { center: [40.3, -82.8], zoom: 6 },
  OK: { center: [35.6, -97.5], zoom: 6 }, OR: { center: [44.0, -120.5], zoom: 6 },
  PA: { center: [40.9, -77.8], zoom: 6 }, RI: { center: [41.7, -71.5], zoom: 9 },
  SC: { center: [33.9, -80.9], zoom: 7 }, SD: { center: [44.4, -100.2], zoom: 6 },
  TN: { center: [35.9, -86.4], zoom: 6 }, TX: { center: [31.5, -99.3], zoom: 5 },
  UT: { center: [39.3, -111.7], zoom: 6 }, VT: { center: [44.1, -72.7], zoom: 7 },
  VA: { center: [37.5, -78.9], zoom: 6 }, WA: { center: [47.4, -120.5], zoom: 6 },
  WV: { center: [38.6, -80.6], zoom: 6 }, WI: { center: [44.6, -89.9], zoom: 6 },
  WY: { center: [43.0, -107.5], zoom: 6 }, PR: { center: [18.2, -66.5], zoom: 8 },
}

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
export default function HomeDroughtMap({ visitorState }: { visitorState?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [show, setShow] = useState(false)

  // Frame on the visitor's state when we know it; otherwise keep the default view.
  const view = (visitorState && STATE_VIEW[visitorState]) || { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }

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
            center={view.center}
            zoom={view.zoom}
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

import Link from 'next/link'
import HomeMapInteractive from './HomeMapInteractive'

// Homepage hero drought map. ONE map only: a flat, branded placeholder paints
// instantly (in the SSR HTML, so first paint is fast), and the single interactive
// Leaflet map fades in over it once its tiles + drought overlay have actually
// loaded. The placeholder is deliberately NOT a map, so the handoff reads as
// "map finished loading" — not a static-map-then-interactive-map swap (the prior
// flicker). No static USDM image anymore.

// Fixed reserved height keeps CLS at zero through placeholder → map.
const MAP_HEIGHT = 460

export default function HomeDroughtMap() {
  return (
    <figure className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-forest-green/10 bg-cream shadow-sm">
      <div className="relative" style={{ height: MAP_HEIGHT }}>
        {/* Flat branded placeholder — instant first paint, intentionally not a map. */}
        <div className="absolute inset-0 flex items-center justify-center bg-forest-green/5">
          <span className="font-dm-sans text-sm font-medium text-forest-green/40 animate-pulse">
            Loading drought map…
          </span>
        </div>

        {/* The single interactive Leaflet map, layered on top; fades in only once
            its tiles + overlay are painted (no flash, no map-to-map swap). */}
        <HomeMapInteractive height={MAP_HEIGHT} />
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

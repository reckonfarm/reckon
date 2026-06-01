import Link from 'next/link'
import HomeMapInteractive from './HomeMapInteractive'

// Homepage hero drought preview. SERVER component: it paints a fast, eagerly-
// discoverable USDM map image FIRST (the LCP — same source the dashboard uses),
// then HomeMapInteractive hydrates the real interactive Leaflet map ON TOP of it
// after first paint. So LCP stays ~FCP (the preloaded image), and the live
// zoomable map is back without the Leaflet-JS/tiles chain blocking render.

// Fixed reserved height keeps CLS at zero through the image → map handoff.
const MAP_HEIGHT = 460

export default function HomeDroughtMap({ mapImageUrl }: { mapImageUrl?: string | null }) {
  return (
    <figure className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-forest-green/10 bg-cream shadow-sm">
      <div className="relative bg-forest-green/5" style={{ height: MAP_HEIGHT }}>
        {mapImageUrl ? (
          /* LCP element: server-rendered, high fetch priority, NOT lazy, intrinsic
             dimensions. Stays in the DOM beneath the live map (it's the largest
             single painted element, so it remains the LCP even after Leaflet loads). */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapImageUrl}
            alt="U.S. Drought Monitor — current conditions"
            width={720}
            height={MAP_HEIGHT}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-dm-sans text-sm text-forest-green/50">Drought map</p>
          </div>
        )}

        {/* Interactive Leaflet, layered on top, loaded after first paint. */}
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

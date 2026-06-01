import Link from 'next/link'

// Homepage hero drought preview. SERVER component rendering a fast, eagerly-
// discoverable USDM map image — the SAME source the dashboard uses (which scores
// great on LCP). Previously this was a client-only Leaflet map (react-leaflet +
// cluster + OSM tiles + /api/usdm overlay) that became the homepage's Largest
// Contentful Paint and painted ~3.7s after FCP. As an above-the-fold preview the
// map was non-interactive anyway, so a high-priority <img> is the LCP fix; the
// live interactive map is one click away via "Explore the full map →".

// Fixed reserved height keeps CLS at zero before/after the image loads.
const MAP_HEIGHT = 460

export default function HomeDroughtMap({ mapImageUrl }: { mapImageUrl?: string | null }) {
  return (
    <figure className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-forest-green/10 bg-cream shadow-sm">
      <div className="flex items-center justify-center bg-forest-green/5" style={{ height: MAP_HEIGHT }}>
        {mapImageUrl ? (
          /* Above-the-fold LCP element: server-rendered, high fetch priority, NOT
             lazy, with intrinsic dimensions so there's no layout shift. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapImageUrl}
            alt="U.S. Drought Monitor — current conditions"
            width={720}
            height={MAP_HEIGHT}
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-contain"
          />
        ) : (
          <p className="font-dm-sans text-sm text-forest-green/50">Drought map</p>
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

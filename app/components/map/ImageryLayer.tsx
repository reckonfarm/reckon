'use client'
import { useEffect, useRef } from 'react'
import { TileLayer } from 'react-leaflet'
import { BASEMAPS, IMAGERY_KEY_MISSING, type Basemap } from '@/lib/map-basemaps'

// ─── The tile layer every map uses (Block 26) ────────────────────────────────
// One place decides what happens when there is no picture to draw:
//   · NO KEY on this build → no satellite layer at all. Never the keyless
//     endpoint. The map says so in one line (IMAGERY_KEY_MISSING_LINE).
//   · TILES FAIL (no signal) → the layer stays, the map's ground is plain, and
//     the caller is told so it can style its shapes for plain ground. Shapes
//     and taps never depended on a tile.
// "Plain" is called when tiles have failed and NONE has loaded — one slow tile
// on one bar is not a dead map — and called off again the moment one paints.
export default function ImageryLayer({ basemap, onPlain }: { basemap: Basemap; onPlain: (plain: boolean) => void }) {
  const tiles = BASEMAPS[basemap]
  const noLayer = basemap === 'satellite' && IMAGERY_KEY_MISSING
  const loaded = useRef(0), failed = useRef(0)
  useEffect(() => { loaded.current = 0; failed.current = 0; onPlain(noLayer) }, [basemap, noLayer, onPlain])
  if (noLayer) return null
  return (
    <TileLayer
      key={basemap}
      url={tiles.url}
      attribution={tiles.attribution}
      maxNativeZoom={tiles.maxNativeZoom}
      maxZoom={tiles.maxZoom}
      eventHandlers={{
        tileload: () => { loaded.current += 1; if (loaded.current === 1) onPlain(false) },
        tileerror: () => { failed.current += 1; if (loaded.current === 0 && failed.current >= 2) onPlain(true) },
      }}
    />
  )
}

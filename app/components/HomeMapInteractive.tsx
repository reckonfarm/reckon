'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

// Interactive drought map that hydrates ON TOP of the homepage hero's fast USDM
// image — AFTER first paint — so it's usable without ever blocking the LCP.
//
// Why this keeps LCP fast: the USDM <img> underneath is one large element
// (~530×460); Leaflet's basemap tiles are individual 256px <img>s, each smaller,
// so the image stays the Largest Contentful Paint even once the map paints. And
// we don't even start loading Leaflet (a heavy chunk + tiles + /api/usdm) until
// the browser is idle post-paint, so it never competes with first render.

const HayMap = dynamic(() => import('@/app/hay/map/HayMapClient'), {
  ssr: false,
  loading: () => null, // the USDM image underneath is the placeholder — no flash
})

export default function HomeMapInteractive({ height }: { height: number }) {
  const [mount, setMount] = useState(false) // begin loading Leaflet
  const [ready, setReady] = useState(false) // fade the live map in over the image

  // Kick off the Leaflet load only once the page is idle (post first paint).
  useEffect(() => {
    let idleId: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const begin = () => setMount(true)
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (typeof w.requestIdleCallback === 'function') idleId = w.requestIdleCallback(begin, { timeout: 1500 })
    else timer = setTimeout(begin, 800)
    return () => {
      if (idleId != null && typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(idleId)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Safety net: if the map never reports ready (tiles blocked, etc.), reveal it
  // anyway after a few seconds rather than leaving it permanently hidden.
  useEffect(() => {
    if (!mount) return
    const t = setTimeout(() => setReady(true), 5000)
    return () => clearTimeout(t)
  }, [mount])

  if (!mount) return null

  return (
    // Held at opacity 0 (fully transparent over the static image) until the live
    // map's tiles + drought overlay have actually painted, THEN cross-fade in — so
    // there's never a half-rendered/differently-framed flash. willChange hints the
    // compositor so the fade is smooth on mobile too.
    <div
      className={`absolute inset-0 transition-opacity duration-700 ease-out ${ready ? 'opacity-100' : 'opacity-0'}`}
      style={{ willChange: 'opacity' }}
      aria-hidden={!ready}
    >
      <HayMap
        listings={[]}
        center={[39.5, -98.5]}
        zoom={4}
        height={`${height}px`}
        interactive
        showLegend={false}
        onReady={() => setReady(true)}
      />
    </div>
  )
}

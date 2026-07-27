'use client'

import dynamic from 'next/dynamic'
import type { RegionalMapClientProps } from './RegionalMapClient'

// Leaflet must run client-side only — load the map client with no SSR (same pattern
// as the hay map). The loader sits inside the Weather view's collapsed "Regional map"
// accordion (Block 2 restored the collapse this loader was originally built for), so
// the map client — and its Leaflet chunk — only loads when the rancher expands it;
// this "Loading map…" box is the beat they see right after expanding.
const RegionalMapClient = dynamic(() => import('./RegionalMapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center rounded-xl border border-forest-green/10 bg-white font-dm-sans text-sm text-forest-green/40">
      Loading map…
    </div>
  ),
})

export default function RegionalMapLoader(props: RegionalMapClientProps) {
  return <RegionalMapClient {...props} />
}

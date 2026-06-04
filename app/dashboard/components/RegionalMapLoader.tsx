'use client'

import dynamic from 'next/dynamic'
import type { RegionalMapClientProps } from './RegionalMapClient'

// Leaflet must run client-side only — load the map client with no SSR (same pattern
// as the hay map). The whole thing lives inside the collapsed "Regional context"
// accordion, so it only mounts when the rancher expands it.
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

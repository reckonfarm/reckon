import type { MetadataRoute } from 'next'
import { flagEnabled } from '@/lib/flags'

// Served at /manifest.webmanifest; Next auto-links it from the document head.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dryline — Your ranch, on the record.',
    short_name: 'Dryline',
    description: flagEnabled('marketplace')
      ? "A shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff."
      : "A shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff.",
    start_url: '/',
    display: 'standalone',
    background_color: '#FDFBF7',
    theme_color: '#1B4332',
    // The rope-line mark (brand, commit 4): opaque, full-bleed forest-green
    // squares — no alpha, no rounded corners — so every launcher masks its own
    // shape and nothing shows black. The old "/icon-*.png" D-mark files are gone.
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}

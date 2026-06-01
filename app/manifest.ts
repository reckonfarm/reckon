import type { MetadataRoute } from 'next'

// Served at /manifest.webmanifest; Next auto-links it from the document head.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dryline',
    short_name: 'Dryline',
    description: 'Drought conditions, FSA LFP eligibility, hay, and cattle prices for your county.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FDFBF7',
    theme_color: '#1B4332',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}

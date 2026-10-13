import type { MetadataRoute } from 'next'
import { flagEnabled } from '@/lib/flags'

// Served at /manifest.webmanifest; Next auto-links it from the document head.
//
// Block 48 — the front door. start_url is /start, which sends a launch to Today
// or Markets by session (R3); id and scope pin the app so a re-install is the
// same app. Three shortcuts for a long-press on the home-screen icon, each at a
// real screen. Two narrow screenshots feed Android's richer install sheet. The
// maskable icon keeps the mark inside the 80% safe zone so a round or squircle
// launcher never clips the rope; the `any` icons stay for everyone else.
//
// The icon itself does not change here until PK picks one at /dev/icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Dryline — Your ranch, on the record.',
    short_name: 'Dryline',
    description: flagEnabled('marketplace')
      ? "A shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff."
      : "A shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff.",
    start_url: '/start?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#FDFBF7',
    theme_color: '#1B4332',
    // The rope-line mark (brand, commit 4): opaque, full-bleed forest-green
    // squares — no alpha, no rounded corners — so every launcher masks its own
    // shape and nothing shows black. The old "/icon-*.png" D-mark files are gone.
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Record feed lands on Today, where Record is one tap: the only ?record=
    // reader there takes preg_check, and this block builds no new deep-link
    // plumbing. Count cattle is its own screen.
    shortcuts: [
      { name: 'Record feed', short_name: 'Record', url: '/today?record=hay_fed&source=shortcut', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Count cattle', short_name: 'Count', url: '/ranch/tally?source=shortcut', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Markets', url: '/markets?source=shortcut', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    screenshots: [
      { src: '/brand/screenshots/today.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Today — the ranch at a glance' },
      { src: '/brand/screenshots/markets.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Markets — what your cattle are worth' },
    ],
  }
}

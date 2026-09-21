import type { NextConfig } from "next";

// Block 26 (PK, 2026-09-21): the Esri basemap key is a public-application key —
// basemaps only, referrer-locked — made to be embedded in a page. It lives in
// ONE env var, ESRI_BASEMAP_KEY; this hands the same value to the browser
// bundle under the public name, so nobody keeps two copies in step. A build
// with no key says so here, and the maps say so where imagery would be —
// never a fall back to the unlicensed keyless endpoint.
if (!process.env.ESRI_BASEMAP_KEY) console.warn('\n[dryline] ESRI_BASEMAP_KEY is not set — maps will draw WITHOUT satellite imagery on this build.\n')

const nextConfig: NextConfig = {
  devIndicators: false,
  env: { NEXT_PUBLIC_ESRI_BASEMAP_KEY: process.env.ESRI_BASEMAP_KEY ?? '' },
  // Block 6A — the old URLs resolve forever (bookmarks, notification links, share
  // cards). Permanent = 301. Session-aware ones (signed-in / and /home → /today)
  // live in middleware.ts, which holds the refreshed session; a config redirect
  // cannot see one. /jobs/[id] and /dashboard?fips= are unchanged.
  // Block 15: the service worker must never be cached by the browser or the
  // CDN — a stale worker would pin a stale shell. Everything it serves is
  // content-hashed; the worker file itself is fetched fresh.
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] }]
  },
  async redirects() {
    return [
      { source: '/herd',          destination: '/ranch/cattle',                 permanent: true },
      { source: '/places',        destination: '/ranch/places',                 permanent: true },
      { source: '/places/:id',    destination: '/ranch/places/:id',             permanent: true },
      { source: '/devices',       destination: '/ranch/devices',                permanent: true },
      { source: '/activity',      destination: '/ranch/activity',               permanent: true },
      { source: '/activity/:id',  destination: '/ranch/activity/:id',           permanent: true },
      { source: '/jobs',          destination: '/ranch/activity?source=machine', permanent: true },
      { source: '/watchlist',     destination: '/weather/locations',            permanent: true },
      { source: '/radar',         destination: '/weather/radar',                permanent: true },
      { source: '/profile',       destination: '/account',                      permanent: true },
    ]
  },
};

export default nextConfig;

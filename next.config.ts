import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Block 6A — the old URLs resolve forever (bookmarks, notification links, share
  // cards). Permanent = 301. Session-aware ones (signed-in / and /home → /today)
  // live in middleware.ts, which holds the refreshed session; a config redirect
  // cannot see one. /jobs/[id] and /dashboard?fips= are unchanged.
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

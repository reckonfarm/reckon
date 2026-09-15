/* Dryline service worker — the minimum app shell (Block 15, ruling 1).
 *
 * WHAT IT CACHES, and nothing else:
 *   1. /_next/static/*  — the app's own scripts, styles and fonts. Cache-first:
 *      every file is content-hashed by the build, so a cached copy is never
 *      stale, and a new build simply brings new names.
 *   2. The LAST TODAY PAGE the phone loaded, as one HTML document, keyed as
 *      the "shell". Network-first: a live page always wins; with no signal the
 *      shell is served for ANY navigation, so the app opens, the record sheet
 *      mounts, the outbox wakes and the bunch list on the phone is offered.
 *      Other pages are not cached: a person with no signal lands on Today,
 *      where recording lives, rather than on an error.
 *   3. /manifest.webmanifest and the brand icons, so the home-screen app keeps
 *      its name and icon offline.
 *
 * WHAT IT NEVER CACHES: any /api/ response (the ledger is read live or not at
 * all), any POST, anything cross-origin (imagery, MARS, USDA). Nothing here
 * writes a record — the outbox in localStorage owns that, and this worker
 * only makes sure there is an app for it to run in.
 *
 * Versioned by name: bump SHELL when the strategy changes and the old caches
 * are dropped on activate.
 */
const SHELL = 'dryline-shell-v1'
const STATIC = 'dryline-static-v1'
const SHELL_KEY = '/__shell__'
const TODAY_RE = /^\/(today|home|dashboard|ranch|weather|markets|account|hay|jobs)(\/|\?|#|$)/

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(n => n !== SHELL && n !== STATIC).map(n => caches.delete(n)))
    await self.clients.claim()
    // The first open installs the worker but is not served by it, so seed the
    // shell now: one signed-in Today, if the phone has one. A redirect to the
    // sign-in page is not the app and is never kept.
    try {
      const res = await fetch('/today', { credentials: 'same-origin' })
      if (res && res.ok && !res.redirected && res.headers.get('content-type')?.includes('text/html')) {
        const cache = await caches.open(SHELL)
        await cache.put(SHELL_KEY, res)
      }
    } catch { /* no signal at install: the next signed-in Today becomes the shell */ }
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // 1. Build assets: cache-first, immutable.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(STATIC, req))
    return
  }
  // 3. The manifest and icons.
  if (url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/brand/')) {
    event.respondWith(cacheFirst(STATIC, req))
    return
  }
  // 2. A navigation: network-first; the shell when there is no network.
  if (req.mode === 'navigate') {
    event.respondWith(navigationFirst(req, url))
  }
})

async function cacheFirst(name, req) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res && res.ok) cache.put(req, res.clone())
  return res
}

async function navigationFirst(req, url) {
  const cache = await caches.open(SHELL)
  try {
    const res = await fetch(req)
    // Keep the newest signed-in Today as the shell. Only a real 200 document,
    // and only a signed-in page — the landing and sign-in are not the app.
    if (res && res.ok && !res.redirected && res.headers.get('content-type')?.includes('text/html') && TODAY_RE.test(url.pathname + url.search)) {
      if (/^\/(today|home)/.test(url.pathname)) cache.put(SHELL_KEY, res.clone())
    }
    return res
  } catch {
    const shell = await cache.match(SHELL_KEY)
    if (shell) return shell
    return new Response(offlineHtml(), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}

function offlineHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dryline</title>
<style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#FDFBF7;color:#20392E;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}main{max-width:420px}h1{font-size:22px;margin:0 0 8px}p{font-size:17px;line-height:1.4;margin:0 0 16px}a{display:inline-block;min-height:48px;line-height:48px;padding:0 20px;border-radius:10px;background:#1B4332;color:#FDFBF7;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>No signal</h1><p>Dryline has not opened on this phone with signal yet, so there is nothing to show. Open it once with service and it will work without.</p><a href="/today">Open Dryline</a></main></body></html>`
}

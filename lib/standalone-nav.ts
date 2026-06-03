// Standalone-PWA-safe client navigation.
//
// When the app is launched from the iOS home screen (display: standalone), the
// WebView silently drops Next.js client-side router navigations to a new URL —
// most reliably on a same-route query-param change such as
// /dashboard?fips=A → /dashboard?fips=B. router.push() returns, the RSC even
// fetches, but the view never commits. This is a long-standing iOS standalone /
// WKWebView limitation (see vercel/next.js#28706, #83386), not a bug in our
// components — which is why it only reproduces from the home-screen app and
// never in Safari or any automated browser.
//
// Fix: in standalone mode do a hard, in-scope navigation. It always commits and
// stays inside the home-screen app (the target is within the manifest scope).
// Regular Safari/desktop keep the fast SPA router.push.

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  // iOS Safari home-screen web app — non-standard, WebKit-only signal.
  if (nav.standalone === true) return true
  // Installed-PWA display mode (Android/desktop, and iOS in newer versions).
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

/**
 * Navigate to an in-app URL. Uses the SPA router in normal browsers; falls back
 * to a hard navigation when running as an installed/standalone PWA, where the
 * iOS WebView drops client-side router navigations.
 */
export function navigateTo(router: { push: (url: string) => void }, url: string): void {
  if (isStandalonePWA()) {
    window.location.assign(url)
  } else {
    router.push(url)
  }
}

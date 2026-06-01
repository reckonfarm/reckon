import { track } from '@vercel/analytics'

// Single funnel for every custom product event. Wraps Vercel's track() so all
// events flow through one place. Best-effort by design: never throws, and
// no-ops cleanly when analytics isn't available (SSR, blocked script, etc.).
//
// PRIVACY: props carry ids, types, buckets, and counts ONLY — never names,
// emails, phones, raw head counts, or exact coordinates.

type AnalyticsValue = string | number | boolean | null
export type AnalyticsProps = Record<string, AnalyticsValue>

export function trackEvent(name: string, props?: AnalyticsProps): void {
  try {
    // Custom events are a client-only concern — never fire during SSR.
    if (typeof window === 'undefined') return
    track(name, props)
  } catch {
    /* analytics is best-effort — it must never break a user action */
  }
}

// Bucket a head count so we capture herd scale without the raw number (PII-ish).
export function bucketHeadCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'unknown'
  if (n <= 50) return '1-50'
  if (n <= 200) return '51-200'
  return '200+'
}

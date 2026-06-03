// Hard timeouts for third-party fetches in the dashboard's server render path.
// A slow or hung upstream (ACIS, CPC/WPC/HPRCC map hosts, USDM) must REJECT after
// this instead of blocking the render forever — the worst-case "the county never
// loads". Every caller already maps a rejection to an HONEST degraded state (a null
// "Updated" timestamp, 'data_unavailable', an empty array, a "temporarily
// unavailable" note), so a timeout simply triggers that existing degrade — it never
// produces a new false/empty-as-real reading.

export const EXTERNAL_FETCH_TIMEOUT_MS = 8000

// An AbortSignal that fires after `ms`, turning a hung fetch into a catchable
// AbortError. Caching is unaffected: on a Next cache hit there is no network leg,
// so the signal never applies.
export function timeoutSignal(ms: number = EXTERNAL_FETCH_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms)
}

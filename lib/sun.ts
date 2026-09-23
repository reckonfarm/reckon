// ─── Sunrise and sunset, computed (Block 39) ─────────────────────────────────
// From the ranch's own coordinates, no service, so it works with no signal and
// costs nothing. NOAA's solar calculator equations (Meeus): the equation of
// time and the sun's declination for the day, then the hour angle at which the
// sun's centre sits 0.833° below the horizon (refraction plus the disc).
// Accurate to about a minute at ranch latitudes, which is the precision a
// person reads it at.

export interface SunTimes {
  /** ISO instants; null above the polar circles when the sun never rises or sets that day. */
  sunrise: string | null
  sunset: string | null
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** The sun's rise and set on the UTC calendar day of `day`, at lat/lng, as instants. */
export function sunTimes(lat: number, lng: number, day: Date): SunTimes {
  // Julian day at 0h UTC of the calendar day.
  const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate()
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
  const jd = jdn - 0.5
  // Solar position for the day (NOAA, from the Julian century).
  const t = (jd - 2451545) / 36525
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289
  const trueLong = L0 + C
  const omega = 125.04 - 1934.136 * t
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega))
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(rad(omega))
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))))
  const yv = Math.tan(rad(eps / 2)) ** 2
  const eqTime = 4 * deg(yv * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yv * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * yv * yv * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)))
  // Hour angle at -0.833°.
  const cosH = (Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl)))) - Math.tan(rad(lat)) * Math.tan(rad(decl))
  if (cosH > 1 || cosH < -1) return { sunrise: null, sunset: null }
  const H = deg(Math.acos(cosH))
  // Minutes after 0h UTC.
  const noonMin = 720 - 4 * lng - eqTime
  const riseMin = noonMin - 4 * H, setMin = noonMin + 4 * H
  const base = Date.UTC(y, m - 1, d)
  return { sunrise: new Date(base + riseMin * 60_000).toISOString(), sunset: new Date(base + setMin * 60_000).toISOString() }
}

/** The rise and set for the ranch's LOCAL calendar day that contains `now` — the UTC day can be tomorrow's by evening. */
export function sunTimesLocal(lat: number, lng: number, now: Date, timeZone: string): SunTimes {
  const local = new Date(now.toLocaleString('en-US', { timeZone }))
  const day = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()))
  return sunTimes(lat, lng, day)
}

// Brand/role color source-of-truth for code that CANNOT use Tailwind classes —
// Leaflet style objects, canvas charts, the OG image, and inline style={{}}.
//
// MIRROR — these values duplicate the @theme block in app/globals.css (CSS classes
// can't be read from a Leaflet/canvas style object, so the values live in two
// places). KEEP THE TWO IN SYNC. A silent, undocumented mirror is exactly how the
// #C2410C warning color drifted apart from brand rust in the first place — this
// header is the leash that keeps them together.

export const forestGreen = '#1B4332' // brand green — body/muted/line/accent today
export const ink = '#1C1917' // headline ink — warm near-black (diverged from forest-green)
export const cream = '#FDFBF7' // app canvas + on-accent text
export const rust = '#8B3A2B' // brand accent (NOT the error state — see warning)
export const warning = '#C2410C' // degraded / error state — semantically distinct from brand rust

// USDM D0–D4 drought palette (mirrors --color-usdm-d0..d4).
export const usdm = {
  d0: '#FFFF00',
  d1: '#FCD37F',
  d2: '#FFAA00',
  d3: '#E60000',
  d4: '#730000',
} as const

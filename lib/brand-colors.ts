// Brand/role color source-of-truth for code that CANNOT use Tailwind classes —
// Leaflet style objects, canvas charts, the OG image, and inline style={{}}.
//
// MIRROR — these values duplicate the @theme block in app/globals.css (CSS classes
// can't be read from a Leaflet/canvas style object, so the values live in two
// places). KEEP THE TWO IN SYNC. A silent, undocumented mirror is exactly how the
// #C2410C warning color drifted apart from brand rust in the first place — this
// header is the leash that keeps them together.

// ── Phase A (A0) roles — MIRROR of the token file's text/surface colors ──
export const canvas = '#FDFBF7'        // page
export const surface = '#FFFFFF'       // one focused task surface
export const ink = '#20392E'           // primary answers, body — 12.05:1 on canvas
export const secondaryInk = '#526257'  // dates, sources — 6.26:1
export const brand = '#1B4332'         // selected controls, primary actions
export const onBrand = '#FFFFFF'
export const rule = '#D3DAD2'          // separators
export const controlBorder = '#6E7D71' // input boundary — never text
export const attention = '#8A4B08'     // planning conflict — 6.57:1
export const danger = '#9A4B24'        // deficit, error — 5.97:1
export const weather = '#225F87'       // weather marks — 6.65:1

// ── Legacy names (retired by A1 / A4; each says what replaces it) ──
export const forestGreen = '#1B4332' // → brand (as a control) or ink (as text)
export const cream = '#FDFBF7' // → canvas
export const rust = '#8B3A2B' // → danger (as text) or down (as a delta)
export const warning = '#C2410C' // → danger

// Price-direction (HerdEstimate). MIRROR of --color-up / --color-down in app/globals.css.
export const up = '#2D6A4F' // positive delta — a lighter forest, brand-calm (NOT a neon gain-green)
export const down = '#8B3A2B' // negative delta — brand rust (same hex as `rust`; NOT the `warning` state)

// USDM D0–D4 drought palette (mirrors --color-usdm-d0..d4).
export const usdm = {
  d0: '#FFFF00',
  d1: '#FCD37F',
  d2: '#FFAA00',
  d3: '#E60000',
  d4: '#730000',
} as const

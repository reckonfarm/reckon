import type { IconKind } from './ForecastPanel'

// Custom brand weather glyphs for the 7-day forecast carousel — inline SVG in the
// Dryline palette (forest-green strokes, rust accents on sun/storm, cream cloud fills),
// replacing the stock emoji. Keyed by the SAME IconKind union iconFor() already returns,
// so the forecast logic is untouched — this only changes how the glyph paints. Designed
// to read at a glance at ~22px on a phone in direct sun: bold strokes, simple shapes.

const FOREST = '#1B4332'   // strokes / clouds / precip
const RUST = '#8B3A2B'     // sun + lightning accents
const CREAM = '#FDFBF7'    // cloud body fill

// One closed cloud, reused across cloud/rain/snow/storm/partly so the body reads
// consistently and can take a cream fill (Lucide-derived geometry, proven legible small).
const CLOUD = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'

function Sun() {
  // Rust disc + eight rays — warmth without leaning on the yellow weather-app cliché.
  const rays = [
    'M12 1.5V4', 'M12 20V22.5', 'M1.5 12H4', 'M20 12H22.5',
    'M4.6 4.6 6.4 6.4', 'M17.6 17.6 19.4 19.4', 'M4.6 19.4 6.4 17.6', 'M17.6 6.4 19.4 4.6',
  ]
  return (
    <g stroke={RUST} strokeWidth={1.75} strokeLinecap="round">
      <circle cx={12} cy={12} r={4.25} fill={RUST} />
      {rays.map((d, i) => <path key={i} d={d} />)}
    </g>
  )
}

function PartlyCloudy() {
  // Small rust sun peeking top-left, a forest-green/cream cloud crossing in front.
  return (
    <>
      <g stroke={RUST} strokeWidth={1.5} strokeLinecap="round">
        <circle cx={9} cy={8.5} r={3} fill={RUST} />
        <path d="M9 2.5V4" /><path d="M3.5 8.5H2" /><path d="M5.1 4.6 6.2 5.7" /><path d="M12.9 4.6 11.8 5.7" />
      </g>
      <g transform="translate(3 5) scale(0.82)">
        <path d={CLOUD} fill={CREAM} stroke={FOREST} strokeWidth={2.1} strokeLinejoin="round" />
      </g>
    </>
  )
}

function Cloud() {
  return <path d={CLOUD} fill={CREAM} stroke={FOREST} strokeWidth={1.75} strokeLinejoin="round" />
}

function CloudBody() {
  // Cloud lifted + shrunk so there's room for precip beneath it within the 24 viewBox.
  return (
    <g transform="translate(0 -2.6) scale(0.9)">
      <path d={CLOUD} fill={CREAM} stroke={FOREST} strokeWidth={1.95} strokeLinejoin="round" />
    </g>
  )
}

function Rain() {
  return (
    <>
      <CloudBody />
      <g stroke={FOREST} strokeWidth={1.85} strokeLinecap="round">
        <path d="M8.5 16.5v3" /><path d="M12 17.5v3" /><path d="M15.5 16.5v3" />
      </g>
    </>
  )
}

function Snow() {
  // Round-capped zero-length strokes render as clean dots — flakes without fiddly stars.
  return (
    <>
      <CloudBody />
      <g stroke={FOREST} strokeWidth={2.4} strokeLinecap="round">
        <path d="M8.5 17h0" /><path d="M12 18.5h0" /><path d="M15.5 17h0" />
        <path d="M10.2 21h0" /><path d="M13.8 21h0" />
      </g>
    </>
  )
}

function Storm() {
  return (
    <>
      <CloudBody />
      <path d="M12.5 15.5 10 19.5h3l-2.5 4" fill="none" stroke={RUST} strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}

const GLYPH: Record<IconKind, () => React.ReactElement> = {
  sun: Sun, partly: PartlyCloudy, cloud: Cloud, rain: Rain, snow: Snow, storm: Storm,
}

export default function WeatherGlyph({ kind, size = 22 }: { kind: IconKind; size?: number }) {
  const Shape = GLYPH[kind]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <Shape />
    </svg>
  )
}

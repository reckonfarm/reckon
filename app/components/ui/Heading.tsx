import type { HTMLAttributes, ReactNode } from 'react'

// Heading — Fraunces, semibold, ink-colored headings, single source of truth for the
// app's heading scale. text-ink is a warm near-black (#1C1917) so headings punch on the
// cream canvas; re-pointing --color-ink flows through every Heading at once.
//
// The modular scale (size + baked leading per level) is the centralized lever: editing
// these rows re-scales every heading on every migrated surface at once. Tightened one rung
// up from the original (bigger, more confident headlines), with the TOP capped for a dense
// news/data app — L1 stops at 3xl/sm:4xl (no 5xl). Display $-stats are NOT part of this
// scale (they stay inline, deliberately, per the anti-gamification guardrail).
//   1 = text-3xl sm:text-4xl  (rare top — EmptyState etc.)
//   2 = text-3xl              (page/section headline — county name, "Cattle Country")
//   3 = text-2xl              (section title — tier headers)
//   4 = text-xl               (article headline)
//   5 = text-lg               (card / accordion / chart titles, compact headline)
type Level = 1 | 2 | 3 | 4 | 5

// Phase A5 — the roles from the token file. Only the page heading is serif; every
// section and card title is DM Sans, so a card is not a headline.
const SIZES: Record<Level, string> = {
  1: 'type-page-heading',
  2: 'type-section-heading',
  3: 'type-section-heading',
  4: 'font-dm-sans text-[18px] leading-6 font-semibold',
  5: 'font-dm-sans text-[18px] leading-6 font-semibold',
}

export function Heading({
  level = 2,
  visual,
  className = '',
  children,
  ...rest
}: { level?: Level; visual?: Level; className?: string; children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5'
  return (
    <Tag className={`text-ink ${SIZES[visual ?? level]} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export default Heading

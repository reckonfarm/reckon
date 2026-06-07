import type { HTMLAttributes, ReactNode } from 'react'

// Heading — Fraunces, semibold, ink-colored headings, single source of truth for the
// app's heading scale. text-ink is a warm near-black (#1C1917) so headings punch on the
// cream canvas; re-pointing --color-ink flows through every Heading at once. level →
// size: 1=text-3xl, 2=text-2xl, 3=text-xl, 4=text-lg, 5=text-base (card/accordion titles —
// real headings at text-base, added when the dashboard joined the system).
type Level = 1 | 2 | 3 | 4 | 5

const SIZES: Record<Level, string> = {
  1: 'text-3xl',
  2: 'text-2xl',
  3: 'text-xl',
  4: 'text-lg',
  5: 'text-base',
}

export function Heading({
  level = 2,
  className = '',
  children,
  ...rest
}: { level?: Level; className?: string; children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5'
  return (
    <Tag className={`font-fraunces font-semibold text-ink ${SIZES[level]} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export default Heading

import type { HTMLAttributes, ReactNode } from 'react'

// Heading — Fraunces, semibold, ink-colored headings, single source of truth for the
// app's heading scale. text-ink == forest-green TODAY (so this is visually identical
// to the current text-forest-green headings); re-pointing --color-ink to a near-black
// in a later commit flows through every Heading at once. level → current size:
// 1=text-3xl, 2=text-2xl, 3=text-xl, 4=text-lg.
type Level = 1 | 2 | 3 | 4

const SIZES: Record<Level, string> = {
  1: 'text-3xl',
  2: 'text-2xl',
  3: 'text-xl',
  4: 'text-lg',
}

export function Heading({
  level = 2,
  className = '',
  children,
  ...rest
}: { level?: Level; className?: string; children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
  return (
    <Tag className={`font-fraunces font-semibold text-ink ${SIZES[level]} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export default Heading

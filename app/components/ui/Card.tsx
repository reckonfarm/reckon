import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

// Card — the single source of truth for the app's raised-surface chrome:
// rounded-xl + hairline border + white surface + sm shadow. Reproduces the current
// de-facto card EXACTLY (border-line/10 == today's border-forest-green/10; bg-surface
// == bg-white). Padding is intentionally NOT baked — it legitimately varies per
// surface (p-5, px-6 py-8, px-4 py-4 sm:px-5, …) — pass it via className. Radius and
// shadow live here on purpose (not promoted to @theme yet) so this component is the
// one place to change them later.
//
// Polymorphic via `as` (default 'div'): a clickable card renders `as="a"` and forwards
// href/target/rel etc. — interactive hover/transition stay caller-supplied via className
// (no `interactive` variant yet). This is a sprint-wide capability, not a one-card hack.
type CardProps<T extends ElementType> = {
  as?: T
  className?: string
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>

export function Card<T extends ElementType = 'div'>({ as, className = '', children, ...rest }: CardProps<T>) {
  const Tag: ElementType = as ?? 'div'
  return (
    <Tag className={`rounded-xl border border-line/10 bg-surface shadow-sm ${className}`} {...(rest as Record<string, unknown>)}>
      {children}
    </Tag>
  )
}

export default Card

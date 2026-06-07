import type { HTMLAttributes, ReactNode } from 'react'

// Card — the single source of truth for the app's raised-surface chrome:
// rounded-xl + hairline border + white surface + sm shadow. Reproduces the current
// de-facto card EXACTLY (border-line/10 == today's border-forest-green/10; bg-surface
// == bg-white). Padding is intentionally NOT baked — it legitimately varies per
// surface (p-5, px-6 py-8, px-4 py-4 sm:px-5, …) — pass it via className. Radius and
// shadow live here on purpose (not promoted to @theme yet) so this component is the
// one place to change them later.
export function Card({
  className = '',
  children,
  ...rest
}: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-line/10 bg-surface shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  )
}

export default Card

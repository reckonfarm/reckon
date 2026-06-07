import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Button — the single source of truth for the app's two button shapes.
// primary: filled brand (bg-accent + cream text); secondary: hairline outline.
// Reproduces the current de-facto button EXACTLY, and standardizes on-accent text to
// cream (the existing majority). The ~10 stray text-white buttons reconcile to cream
// when their surface is migrated — NOT touched in this commit. Shape/size/weight live
// here as the single source of truth.
type Variant = 'primary' | 'secondary'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-cream hover:bg-accent/90',
  secondary: 'border border-line/20 text-accent hover:bg-accent/5',
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: { variant?: Variant; className?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-lg px-4 py-2.5 font-dm-sans text-sm font-semibold transition-colors ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export default Button

import type { HTMLAttributes, ReactNode } from 'react'

// Eyebrow — the small uppercase label over a card's content ("Hay", "This season",
// "Drought / LFP"). ONE token (shell pass, commit 6): before this there were two
// competing inline variants (forest-green/40 tracking-wide vs muted/50
// tracking-wider — the same green at two opacities and two trackings) copied
// across a dozen files. Re-pointing this string re-styles every eyebrow at once.
export const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40'

export function Eyebrow({ className = '', children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`${EYEBROW} ${className}`} {...rest}>
      {children}
    </p>
  )
}

export default Eyebrow

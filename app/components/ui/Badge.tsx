import type { ReactNode } from 'react'

// Badge — pill label, single source of truth for the app's badge tones.
// rust:   warning/near-you emphasis (bg-rust/10 + rust text) — the "Near you" badge.
// accent: filled brand chip (bg-accent + cream text).
// soft:   quiet brand chip (bg-accent/10 + accent text).
// Reproduces the current de-facto badge styling; tones cover today's variants.
type Tone = 'rust' | 'accent' | 'soft'

const TONES: Record<Tone, string> = {
  rust: 'bg-rust/10 text-rust',
  accent: 'bg-accent text-cream',
  soft: 'bg-accent/10 text-accent',
}

export function Badge({
  tone = 'soft',
  className = '',
  children,
}: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-dm-sans text-[11px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export default Badge

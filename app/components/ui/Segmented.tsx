'use client'

import { useId, useRef, type KeyboardEvent } from 'react'

// Segmented — the app's one segmented control: an inset track with a single white thumb
// that slides between equal-width segments (Apple-quiet, Robinhood-restrained). Controlled
// only — pass `value` + `onChange`; it carries NO app logic, so the three callers it's
// built for each decide what a change means:
//   • the dashboard view switch (News/Weather/Hay/Markets) → onChange navigates,
//   • the LRP sale-window picker                            → onChange sets the picked rung,
//   • the new Now/Trend/Outlook toggle                      → onChange sets the panel.
// General over segment count (2…n). Token-based: bg-accent track, bg-surface thumb on the
// --shadow-pop lift.
//
// A11y: role="radiogroup" + roving-tabindex radios. ←/→/↑/↓ move selection, Home/End jump
// to the ends, click selects; only the active segment is in the tab order. Visible
// focus-visible ring. The thumb slide is disabled under prefers-reduced-motion. 44px min
// target so it's usable from the tractor cab.

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Required: names the group for screen readers (e.g. "Dashboard view"). */
  ariaLabel: string
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const n = options.length
  const selectedIndex = options.findIndex(o => o.value === value)

  // Move selection + focus together (roving tabindex), wrapping at the ends.
  function move(to: number) {
    const i = (to + n) % n
    onChange(options[i].value)
    refs.current[i]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault(); move(i + 1); break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault(); move(i - 1); break
      case 'Home':
        e.preventDefault(); move(0); break
      case 'End':
        e.preventDefault(); move(n - 1); break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative flex w-full rounded-xl bg-accent/[0.07] p-1 ${className}`}
    >
      {/* Sliding thumb — rendered only when the current value matches a segment. Width is
          one segment of the padded track; it translates by whole multiples of its own width
          so it lands exactly on each segment regardless of count. */}
      {selectedIndex >= 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-surface shadow-pop transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: `calc((100% - 0.5rem) / ${n})`,
            transform: `translateX(${selectedIndex * 100}%)`,
          }}
        />
      )}

      {options.map((o, i) => {
        const selected = i === selectedIndex
        return (
          <button
            key={o.value}
            ref={el => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the selected segment (or the first, if none) is the single
            // tab stop; arrows move within the group.
            tabIndex={selected || (selectedIndex < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={[
              'relative z-10 flex-1 basis-0 min-h-[44px] inline-flex items-center justify-center rounded-lg px-3',
              'font-dm-sans text-sm whitespace-nowrap transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              selected ? 'font-semibold text-accent' : 'font-medium text-accent/55 hover:text-accent/80',
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented

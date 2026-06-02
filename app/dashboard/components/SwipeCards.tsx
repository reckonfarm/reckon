'use client'

import { Children, useRef, useState } from 'react'

// Mobile: a horizontal, snap-scrolling row of cards with a peek of the next card
// and dot indicators. Desktop (sm+): reverts to a normal multi-column grid.
// Used for the Regional-context outlook maps. Desktop layout is unchanged.
export default function SwipeCards({
  children,
  smCols = 2,
}: {
  children: React.ReactNode
  smCols?: 2 | 3
}) {
  const items = Children.toArray(children)
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  function onScroll() {
    const el = ref.current
    if (!el || items.length < 2) return
    const stride = el.scrollWidth / items.length
    setActive(Math.min(items.length - 1, Math.max(0, Math.round(el.scrollLeft / stride))))
  }

  const gridCols = smCols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'

  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        className={`flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid ${gridCols} sm:overflow-visible sm:pb-0`}
      >
        {items.map((child, i) => (
          <div key={i} className="snap-center shrink-0 basis-[85%] sm:basis-auto sm:shrink">
            {child}
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5 sm:hidden">
          {items.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === active ? 'bg-forest-green' : 'bg-forest-green/25'}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'

interface Tab {
  id: string
  label: string
}

interface Props {
  tabs: Tab[]
  activeTab: string
  onChange: (id: string) => void
}

export default function TabBar({ tabs, activeTab, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [showFade, setShowFade] = useState(false)

  function checkFade() {
    const el = scrollRef.current
    if (!el) return
    const overflows = el.scrollWidth > el.clientWidth
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
    setShowFade(overflows && !atEnd)
  }

  useEffect(() => {
    checkFade()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkFade, { passive: true })
    window.addEventListener('resize', checkFade, { passive: true })
    return () => {
      el.removeEventListener('scroll', checkFade)
      window.removeEventListener('resize', checkFade)
    }
  }, [])

  useEffect(() => {
    buttonRefs.current.get(activeTab)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [activeTab])

  return (
    <div className="relative border-b border-forest-green/10">
      <div ref={scrollRef} className="overflow-x-auto">
        <div className="flex min-w-max">
          {tabs.map(tab => (
            <button
              key={tab.id}
              ref={el => {
                if (el) buttonRefs.current.set(tab.id, el)
                else buttonRefs.current.delete(tab.id)
              }}
              onClick={() => onChange(tab.id)}
              className={[
                'px-4 py-2.5 text-sm font-medium font-dm-sans whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'border-b-2 border-forest-green text-forest-green'
                  : 'text-forest-green/50 hover:text-forest-green/80',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {showFade && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />
      )}
    </div>
  )
}

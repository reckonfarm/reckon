'use client'

import { useState } from 'react'

interface DashboardAccordionProps {
  title: string
  preview?: string
  previewAmount?: string
  children: React.ReactNode
  defaultOpen?: boolean
  highlight?: boolean
}

export default function DashboardAccordion({
  title,
  preview,
  previewAmount,
  children,
  defaultOpen = false,
  highlight = false,
}: DashboardAccordionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`rounded-xl overflow-hidden ${highlight ? 'border-2 border-forest-green shadow-[0_0_0_4px_rgba(27,67,50,0.08)]' : 'border border-forest-green/10'}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-5 py-4 transition-colors text-left ${highlight ? 'bg-forest-green hover:bg-forest-green/90' : 'bg-white hover:bg-forest-green/5'}`}
        aria-expanded={open}
      >
        <div className="flex flex-col gap-0.5">
          {/* Accordion title is a real heading but lives inside the toggle <button>, where
              an <h5> would be invalid HTML — so it stays a <span> and takes the near-black
              ink directly (text-ink) to match the rest of the migrated headings. Highlight
              (triggered, on the green header) keeps cream. */}
          <span className={`font-fraunces text-base font-semibold ${highlight ? 'text-cream' : 'text-ink'}`}>
            {title}
          </span>
          {preview && !open && (
            <span className={`text-sm font-dm-sans ${highlight ? 'text-cream/70' : 'text-forest-green/50'}`}>
              {preview}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {previewAmount && !open && (
            <span className={`font-fraunces text-xl font-semibold ${highlight ? 'text-cream' : 'text-forest-green'}`}>
              {previewAmount}
            </span>
          )}
          <svg
            className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''} ${highlight ? 'text-cream/60' : 'text-forest-green/40'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>
      {open && (
        <div className={`border-t px-5 py-5 ${highlight ? 'border-forest-green/20 bg-forest-green/5' : 'border-forest-green/10 bg-white'}`}>
          {children}
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'

interface DashboardAccordionProps {
  title: string
  preview?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export default function DashboardAccordion({
  title,
  preview,
  children,
  defaultOpen = false,
}: DashboardAccordionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-forest-green/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-forest-green/5 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-fraunces text-base font-semibold text-forest-green">
            {title}
          </span>
          {preview && !open && (
            <span className="text-sm text-forest-green/50 font-dm-sans">
              {preview}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-forest-green/40 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-forest-green/10 bg-white px-5 py-5">
          {children}
        </div>
      )}
    </div>
  )
}

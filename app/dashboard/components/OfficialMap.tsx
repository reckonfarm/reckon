'use client'

import { useState, useEffect } from 'react'

export interface OfficialMapRecord {
  id: number
  map_type: string
  scope: string | null
  release_date: string
  image_url: string
  source_url: string
}

interface Props {
  map: OfficialMapRecord | null
  title: string
  note?: string
  className?: string
  regionalMapUrl?: string | null
}

function regionLabel(url: string): string {
  const filename = url.split('/').pop() ?? ''
  const slug = filename.replace('_text.png', '').split('_').slice(1).join('_')
  return slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function extractUrl(value: string): string {
  const m = value.match(/^\[.*?\]\((.*?)\)$/)
  return m ? m[1] : value
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function OfficialMap({ map, title, note, className = '', regionalMapUrl }: Props) {
  const displayTitle = regionalMapUrl ? `USDM — ${regionLabel(regionalMapUrl)}` : title
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen])

  if (!map) {
    return (
      <div
        className={`flex min-h-[180px] items-center justify-center rounded-xl border border-forest-green/10 bg-white p-6 text-center ${className}`}
      >
        <div>
          <p className="text-sm font-medium text-forest-green/60 font-dm-sans">{displayTitle}</p>
          <p className="mt-1 text-xs text-forest-green/40 font-dm-sans">
            Official map updating — check back after the next Tuesday release.
          </p>
        </div>
      </div>
    )
  }

  const imgSrc = regionalMapUrl ?? map.image_url

  return (
    <div
      className={`overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm ${className}`}
    >
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">{displayTitle}</h2>
      </div>
      <div className="p-4 sm:p-6">
        <div
          className="group relative aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg"
          onClick={() => setIsOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={displayTitle}
            className="h-full w-full object-contain transition-opacity group-hover:opacity-90"
            loading="lazy"
          />
          <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            Click to enlarge
          </span>
        </div>
        <p className="mt-3 text-xs text-forest-green/50 font-dm-sans">
          Released {formatDate(map.release_date)} ·{' '}
          <a
            href={extractUrl(map.source_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-forest-green/70"
          >
            Source
          </a>
        </p>
        {note && (
          <p className="mt-1 text-xs text-forest-green/40 font-dm-sans">{note}</p>
        )}
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setIsOpen(false)}
        >
          <button
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={displayTitle}
            className="max-h-screen max-w-5xl object-contain p-4"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

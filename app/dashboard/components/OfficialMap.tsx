'use client'

import { useState } from 'react'
import MapLightbox from './MapLightbox'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'

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

  if (!map) {
    return (
      <Card
        shadow="none"
        className={`flex min-h-[180px] items-center justify-center p-6 text-center ${className}`}
      >
        <div>
          <p className="text-sm font-medium text-forest-green/60 font-dm-sans">{displayTitle}</p>
          <p className="mt-1 text-xs text-forest-green/40 font-dm-sans">
            Official map updating — check back after the next Tuesday release.
          </p>
        </div>
      </Card>
    )
  }

  const imgSrc = regionalMapUrl ?? map.image_url

  return (
    <Card
      className={`overflow-hidden transition-shadow hover:shadow-md ${className}`}
    >
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <Heading level={5}>{displayTitle}</Heading>
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
          <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            Tap to enlarge
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

      <MapLightbox open={isOpen} onClose={() => setIsOpen(false)} src={imgSrc} alt={displayTitle} />
    </Card>
  )
}

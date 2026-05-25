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
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function OfficialMap({ map, title, note, className = '' }: Props) {
  if (!map) {
    return (
      <div
        className={`flex min-h-[180px] items-center justify-center rounded-xl border border-forest-green/10 bg-white p-6 text-center ${className}`}
      >
        <div>
          <p className="text-sm font-medium text-forest-green/60 font-dm-sans">{title}</p>
          <p className="mt-1 text-xs text-forest-green/40 font-dm-sans">
            Official map updating — check back after the next Tuesday release.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm ${className}`}
    >
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">{title}</h2>
      </div>
      <div className="p-4 sm:p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={map.image_url}
          alt={title}
          className="w-full rounded-lg"
          loading="lazy"
        />
        <p className="mt-3 text-xs text-forest-green/50 font-dm-sans">
          Released {formatDate(map.release_date)} ·{' '}
          <a
            href={map.source_url}
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
    </div>
  )
}

import Link from 'next/link'

// Two-way segmented control marking Market News and the Drought dashboard as PEER
// views of one county. Preserves fips. News is the DEFAULT (bare /dashboard, no view
// param); Drought is opt-in via &view=drought. Server component — two styled links.

export default function DroughtCattleToggle({
  fips,
  active,
}: {
  fips: string
  active: 'news' | 'drought'
}) {
  const seg = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'flex-1 rounded-md px-4 py-1.5 text-center font-dm-sans text-sm font-medium transition-colors',
        isActive
          ? 'bg-forest-green text-white shadow-sm'
          : 'text-forest-green/60 hover:bg-forest-green/5',
      ].join(' ')}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex w-full rounded-lg border border-forest-green/15 bg-white p-0.5">
      {seg(`/dashboard?fips=${fips}`, 'Market News', active === 'news')}
      {seg(`/dashboard?fips=${fips}&view=drought`, 'Drought', active === 'drought')}
    </div>
  )
}

import Link from 'next/link'

// Two-way segmented control marking the drought dashboard and the cattle market
// as PEER views of one county. Preserves fips across both directions. Server
// component — just two styled links, no interactivity needed.

export default function DroughtCattleToggle({
  fips,
  active,
}: {
  fips: string
  active: 'drought' | 'cattle'
}) {
  const q = `?fips=${fips}`
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
      {seg(`/dashboard${q}`, 'Drought', active === 'drought')}
      {seg(`/cattle${q}`, 'Cattle market', active === 'cattle')}
    </div>
  )
}

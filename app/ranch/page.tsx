import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getRanch } from '@/lib/ranch-membership'
import { privateTitle } from '@/lib/private-title'

// ─── /ranch — the ranch hub (Block 6A, commit 1: the shell) ───────────────────
// Five sections. Recent activity rows and the live numbers per section land in
// commit 5; until then this is the door to each section, nothing invented.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Ranch')

const SECTIONS: { href: string; label: string; blurb: string }[] = [
  { href: '/ranch/activity', label: 'Activity', blurb: 'Everything recorded, by the day the work happened.' },
  { href: '/ranch/cattle',   label: 'Cattle',   blurb: 'Your lots — head, purpose, last recorded work.' },
  { href: '/ranch/hay',      label: 'Hay',      blurb: 'Bales on hand, fed, and stacked.' },
  { href: '/ranch/places',   label: 'Places',   blurb: 'Where things happen — pastures, stacks, tanks.' },
  { href: '/ranch/devices',  label: 'Devices',  blurb: 'Connected machines and loggers.' },
]

export default async function RanchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch')
  const ranch = await getRanch(supabase, user.id).catch(() => null)
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch</p>
        <h1 className="mt-1 type-page-heading text-ink">{ranch?.name ?? 'Your ranch'}</h1>
        <Card className="mt-4 p-0">
          <ul className="divide-y divide-rule" data-audit="ranch-sections">
            {SECTIONS.map(s => (
              <li key={s.href}>
                <Link href={s.href} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="ranch-section">
                  <span className="min-w-0">
                    <span className="block font-dm-sans text-[17px] font-semibold text-ink">{s.label}</span>
                    <span className="block font-dm-sans text-[15px] text-secondary-ink">{s.blurb}</span>
                  </span>
                  <span aria-hidden className="shrink-0 font-dm-sans text-[17px] text-secondary-ink">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  )
}

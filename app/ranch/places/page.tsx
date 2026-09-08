import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { privateTitle } from '@/lib/private-title'
import { placeRows } from '@/lib/places/rows'
import { MANUAL_EVENT_LABELS, isManualEventType } from '@/lib/manual-log'
import { fmtDay } from '@/lib/jobs/format'
import RecordHere from './RecordHere'

// ─── /ranch/places (Block 6A) — the Places section ───────────────────────────
// The list first. Each row: name, type, last recorded work, last recorded rain
// — the last two only when a line exists (never an inferred zero). A place is
// created by the record sheet's "new place" field, so the page offers Record
// here rather than a separate create form.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Places')

const kindLabel = (k: string) => k.replace(/_/g, ' ')

export default async function PlacesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/places')
  const rows = await placeRows(supabase)
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Places</p>
        <h1 className="mt-1 type-page-heading text-ink">Places</h1>
        {rows.length === 0 ? (
          <Card className="mt-4 p-5">
            <p className="font-dm-sans text-[17px] text-ink">No places named yet. Record work and name the place in the same entry — it is created with it.</p>
          </Card>
        ) : (
          <Card className="mt-4 p-0">
            <ul className="divide-y divide-rule" data-audit="place-rows">
              {rows.map(p => (
                <li key={p.id}>
                  <Link href={`/ranch/places/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="place-row">
                    <span className="min-w-0">
                      <span className="block font-dm-sans text-[17px] font-semibold text-ink">{p.name} <span className="font-normal text-secondary-ink">· {kindLabel(p.kind)}</span></span>
                      <span className="block font-dm-sans text-[15px] text-secondary-ink">
                        {p.lastWork ? <span data-audit="place-last-work">Last recorded work: {isManualEventType(p.lastWork.type) ? MANUAL_EVENT_LABELS[p.lastWork.type].toLowerCase() : p.lastWork.type}, {fmtDay(p.lastWork.ts)}</span> : <span>Nothing recorded here yet</span>}
                        {p.lastRain && <span data-audit="place-last-rain"> · Last recorded rain: {p.lastRain.inches.toFixed(2)}&quot;, {fmtDay(p.lastRain.ts)}</span>}
                      </span>
                    </span>
                    <span aria-hidden className="shrink-0 font-dm-sans text-[17px] text-secondary-ink">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-4"><RecordHere /></div>
      </main>
    </>
  )
}

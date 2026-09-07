import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getEvent } from '@/lib/activity'
import { fmtDay, fmtTime, dayKey } from '@/lib/jobs/format'

// ─── /activity/[id] — the exact event (Block 5A) ─────────────────────────────
// Opened by its stable id from a handoff row, a Recently logged row, a place, or
// the record. States the actor and their role, lot, place, quantity with units,
// WORK time and RECORDING time as separate fields (a backdated entry explains
// itself), and sync state. The correction chain lands here in 5B.
export const dynamic = 'force-dynamic'

const when = (iso: string) => `${fmtDay(iso, 'long')} · ${fmtTime(iso)}`

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/activity/${id}`)}`)
  const ev = await getEvent(supabase, user.id, id)
  if (!ev) notFound()
  const { row, names, actorRole, line, quantity, placeId, lotId } = ev
  const backdated = dayKey(row.ts) !== dayKey(row.ingested_at)
  const placeName = names.place(placeId)
  const lotName = names.lot(lotId)
  const rows: [string, React.ReactNode][] = [
    ['Who', <>{names.person(row.user_id)} <span className="text-secondary-ink">· {actorRole}</span></>],
    ['What', line],
    ...(quantity ? [['Quantity', quantity] as [string, React.ReactNode]] : []),
    ...(lotName ? [['Lot', lotName] as [string, React.ReactNode]] : []),
    ...(placeName && placeId ? [['Place', <Link key="p" href={`/places/${placeId}`} className="font-semibold text-brand underline underline-offset-2">{placeName}</Link>] as [string, React.ReactNode]] : []),
    ['Work time', when(row.ts)],
    ['Recorded', when(row.ingested_at)],
    ['Sync', row.device_id ? 'Received from a device' : 'Synced to ranch'],
  ]
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>The record · one entry</p>
        <h1 className="mt-1 type-page-heading text-ink" data-audit="event-line">{line}</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">{fmtDay(row.ts, 'long')}, recorded by {names.person(row.user_id)}.</p>

        <Card className="mt-4 p-0" data-audit="event-detail">
          <dl className="divide-y divide-rule">
            {rows.map(([k, v]) => (
              <div key={k} className="flex min-h-[52px] items-baseline gap-4 px-4 py-3">
                <dt className="w-28 shrink-0 font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">{k}</dt>
                <dd className="font-dm-sans text-[17px] leading-snug text-ink" data-audit={`event-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {backdated && (
          <p className="mt-3 font-dm-sans text-[16px] leading-snug text-ink" data-audit="event-backdated">
            This entry was recorded on a later day than the work it describes. Both dates are shown above; the balance uses the work time.
          </p>
        )}
        <p className="mt-3 font-dm-sans text-[14px] text-secondary-ink">Entry {row.id}</p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/activity${placeId ? `?place=${placeId}` : ''}`} className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink">{placeName ? `All activity at ${placeName}` : 'All activity'}</Link>
          <Link href="/home" className="inline-flex min-h-[48px] items-center px-2 font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Back to Today</Link>
        </div>
      </main>
    </>
  )
}

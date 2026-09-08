import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getPlaceHistory } from '@/lib/places/history'
import { listActivity, describeEvent } from '@/lib/activity'
import { fmtDay, fmtTime, dayKey, todayKey } from '@/lib/jobs/format'
import { privateTitle } from '@/lib/private-title'
import PlaceActions from '../PlaceActions'
import RecordHere from '../RecordHere'

// ─── /ranch/places/[id] (Block 6A) ────────────────────────────────────────────
// name / type → recent rain, work, and stock lines → the full activity here
// (the Block 5 record, filtered) → connected devices. One primary Record here;
// the old full-width log bar is gone. No "cattle currently here": the model
// holds no lot placement. No map: nothing here would draw one honestly yet.
export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('places').select('name').eq('id', id).maybeSingle()
  return privateTitle((data as { name?: string } | null)?.name?.trim() || 'Place')
}

const kindLabel = (k: string) => k.replace(/_/g, ' ')

export default async function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=/ranch/places/${id}`)

  const [history, activity, devicesRes] = await Promise.all([
    getPlaceHistory(supabase, id),
    listActivity(supabase, user.id, { place: id }, null).catch(() => null),
    supabase.from('devices').select('id, name, type, last_seen').eq('place_id', id).order('name'),
  ])
  if (!history.place) notFound()
  const { place, memory, counts } = history
  const rows = activity?.rows.slice(0, 10) ?? []
  const devices = (devicesRes.data ?? []) as { id: string; name: string; type: string; last_seen: string | null }[]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className="mb-3 font-dm-sans text-[16px]">
          <Link href="/ranch/places" className="inline-flex min-h-[44px] items-center font-semibold text-brand underline underline-offset-2">All places</Link>
        </p>
        <p className={EYEBROW}>{kindLabel(place.kind)}</p>
        <h1 className="mt-1 type-page-heading text-ink">{place.name}</h1>

        <div className="mt-4"><RecordHere placeId={place.id} placeName={place.name} /></div>

        <section className="mt-6" aria-labelledby="place-recent">
          <h2 id="place-recent" className={`${EYEBROW} !text-ink`}>Recent here</h2>
          <Card className="mt-2 p-4 sm:p-5">
            {memory.length === 0 ? (
              <p className="font-dm-sans text-[17px] text-ink">Nothing recorded here yet. The first entry starts its memory.</p>
            ) : (
              <ul className="space-y-2">
                {memory.map(m => (
                  <li key={m.kind} className="font-dm-sans text-[17px] leading-snug text-forest-green">
                    <span className="text-ink">{m.label}:</span> <Link href={`/ranch/activity/${m.eventId}`} className="underline underline-offset-2">{m.answer}</Link>
                  </li>
                ))}
              </ul>
            )}
            {counts.entries > 0 && counts.sinceIso && (
              <p className="mt-3 font-dm-sans text-[16px] text-ink">
                <Link href={`/ranch/activity?place=${place.id}`} className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2" data-audit="place-entries-link">
                  View {counts.entries} {counts.entries === 1 ? 'entry' : 'entries'} · since {fmtDay(counts.sinceIso)} →
                </Link>
              </p>
            )}
            <div className="mt-2"><PlaceActions placeId={place.id} placeName={place.name} memory={memory} /></div>
          </Card>
        </section>

        {rows.length > 0 && (
          <section className="mt-6" aria-labelledby="place-activity">
            <h2 id="place-activity" className={`${EYEBROW} !text-ink`}>Activity here</h2>
            <Card className="mt-2 p-0">
              <ol className="divide-y divide-rule" data-audit="place-activity">
                {rows.map(r => (
                  <li key={r.id}>
                    <Link href={`/ranch/activity/${r.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]">
                      <span className="min-w-0 font-dm-sans text-[17px] leading-snug text-ink"><span className="font-semibold">{activity!.names.person(r.user_id)}</span> · {describeEvent(r, activity!.names)}</span>
                      <span className="shrink-0 font-dm-sans text-[15px] tabular-nums text-secondary-ink">{dayKey(r.ts) === todayKey() ? fmtTime(r.ts) : fmtDay(r.ts)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
            {(activity?.nextCursor || (activity?.rows.length ?? 0) > rows.length) && (
              <p className="mt-2"><Link href={`/ranch/activity?place=${place.id}`} className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">All activity here →</Link></p>
            )}
          </section>
        )}

        {devices.length > 0 && (
          <section className="mt-6" aria-labelledby="place-devices">
            <h2 id="place-devices" className={`${EYEBROW} !text-ink`}>Connected devices</h2>
            <Card className="mt-2 p-0">
              <ul className="divide-y divide-rule">
                {devices.map(d => (
                  <li key={d.id}>
                    <Link href={`/ranch/devices#${d.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
                      <span className="font-dm-sans text-[17px] text-ink">{d.name} <span className="text-secondary-ink">· {kindLabel(d.type)}</span></span>
                      <span className="font-dm-sans text-[15px] text-secondary-ink">{d.last_seen ? `Last collected ${fmtDay(d.last_seen)}` : 'Waiting for collection'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </main>
    </>
  )
}

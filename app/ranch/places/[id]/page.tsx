import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getPlaceHistory } from '@/lib/places/history'
import { listActivity, describeEvent, standingRows, chainWithin } from '@/lib/activity'
import ActivityRowItem, { markerFor } from '@/app/components/ActivityRowItem'
import { fmtDay, fmtTime, dayKey, todayKey } from '@/lib/jobs/format'
import { privateTitle } from '@/lib/private-title'
import PlaceActions from '../PlaceActions'
import RecordHere from '../RecordHere'
import DrawPlace from '../DrawPlace'
import EditPlace from '../EditPlace'
import { placeRing, resolveMapCentre } from '@/lib/places/anchor'
import { kindLabel } from '@/lib/places/kinds'

// ─── /ranch/places/[id] (Block 6A · the shape in slice 1) ─────────────────────
// name / type → THE GROUND (its shape on satellite, with acreage, or the offer
// to draw one) → recent rain, work, and stock lines → the full activity here
// (the Block 5 record, filtered) → connected devices. One primary Record here.
// No "cattle currently here": the model holds no lot placement.
//
// The map used to be absent because nothing here would draw one honestly. Now
// a drawn place draws itself, and an undrawn one still says so in words rather
// than showing an empty map.
export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('places').select('name').eq('id', id).maybeSingle()
  return privateTitle((data as { name?: string } | null)?.name?.trim() || 'Place')
}

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
  const ring = placeRing(place.geometry)
  const centre = await resolveMapCentre(supabase, user.id, ring ? [ring] : [])
  const rows = activity ? standingRows(activity.rows).slice(0, 10) : []
  const devices = (devicesRes.data ?? []) as { id: string; name: string; type: string; last_seen: string | null }[]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className="mb-3 font-dm-sans text-[16px]">
          <Link href="/ranch/places" className="inline-flex min-h-[44px] items-center font-semibold text-brand underline underline-offset-2">All places</Link>
        </p>
        <p className={EYEBROW}>{kindLabel(place.kind)}{place.retired_at ? ' · retired' : ''}</p>
        <h1 className="mt-1 type-page-heading text-ink">{place.name}</h1>

        {/* Correcting what a place IS (057): name, kind, retire. A retired place
            shows only the way back — the route refuses every other edit on one,
            so offering more would be a button that can only fail. */}
        <EditPlace place={{ id: place.id, name: place.name, kind: place.kind, updatedAt: place.updated_at, retiredAt: place.retired_at }} />

        {!place.retired_at && <div className="mt-4"><RecordHere placeId={place.id} placeName={place.name} /></div>}

        <section className="mt-6" aria-labelledby="place-ground">
          <h2 id="place-ground" className={`${EYEBROW} !text-ink`}>The ground</h2>
          <div className="mt-2">
            {place.retired_at ? (
              ring
                ? <DrawPlace place={{ id: place.id, name: place.name, kind: place.kind, ring, acres: place.acres }} initialCenter={centre} />
                : <p className="font-dm-sans text-[15px] text-secondary-ink">This place was retired without a shape drawn.</p>
            ) : (
              <>
                <DrawPlace
                  place={{ id: place.id, name: place.name, kind: place.kind, ring, acres: place.acres }}
                  initialCenter={centre}
                />
                {!ring && (
                  <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
                    This place has a name but no shape yet. Draw it once and it stays drawn.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

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
                {/* Operational (6B): what stands here, a correction marked, what it replaced one tap away. */}
                {rows.map(r => <ActivityRowItem key={r.id} id={r.id} who={activity!.names.person(r.user_id)} line={describeEvent(r, activity!.names)} when={dayKey(r.ts) === todayKey() ? fmtTime(r.ts) : fmtDay(r.ts)} marker={markerFor(r)} chain={chainWithin(activity!.rows, r, activity!.names)} />)}
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

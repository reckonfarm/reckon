import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getPlaceHistory } from '@/lib/places/history'
import { fmtDay } from '@/lib/jobs/format'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import LogIt from '@/app/dashboard/components/LogIt'
import PlaceActions from '../PlaceActions'

// ─── A place page (Block 2F) ──────────────────────────────────────────────────
// Opens with the place's practical memory — the most recent line of each kind
// that names it — then the two or three things that make sense to log here,
// then retrieval chips that answer "when did we last…" from the same records.
// RLS-scoped throughout: a place another ranch owns is a 404, not a hint.

export const dynamic = 'force-dynamic'

export default async function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=/places/${id}`)

  const history = await getPlaceHistory(supabase, id)
  if (!history.place) notFound()
  const { place, memory, counts } = history

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="mb-4 font-dm-sans text-[15px]">
          <Link href="/places" className="font-semibold text-forest-green underline underline-offset-2">All places</Link>
        </p>

        <Card shadow="soft" className="p-5 sm:p-6">
          <p className={EYEBROW}>{place.kind}</p>
          <h1 className="mt-1 font-fraunces text-[32px] font-semibold leading-tight text-forest-green sm:text-[36px]">{place.name}</h1>

          {memory.length === 0 ? (
            <p className="mt-4 font-dm-sans text-[17px] text-forest-green/80">
              Nothing logged here yet. The first entry starts its memory.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {memory.map(m => (
                <li key={m.kind} className="font-dm-sans text-[17px] leading-snug text-forest-green">
                  <span className="text-forest-green/80">{m.label}:</span> {m.answer}
                </li>
              ))}
            </ul>
          )}
          {counts.entries > 0 && counts.sinceIso && (
            <p className="mt-3 font-dm-sans text-[15px] text-forest-green/80">
              {counts.entries} {counts.entries === 1 ? 'entry' : 'entries'} here since {fmtDay(counts.sinceIso)}.
            </p>
          )}
        </Card>

        {/* Log it (the sheet + its status strip) is mounted here so the actions
            below can open it pre-filled with this place. */}
        <div className="mt-4 space-y-4">
          <PlaceActions placeId={place.id} placeName={place.name} memory={memory} />
          <LogIt />
        </div>
      </main>
    </>
  )
}

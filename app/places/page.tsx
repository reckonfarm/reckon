import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// The ranch's named places (RLS-scoped), each a link to its memory.
export const dynamic = 'force-dynamic'

export default async function PlacesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/places')
  const { data } = await supabase.from('places').select('id, name, kind').order('name', { ascending: true })
  const places = (data ?? []) as { id: string; name: string; kind: string }[]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className={EYEBROW}>Places</p>
        <h1 className="mt-1 font-fraunces text-[32px] font-semibold leading-tight text-forest-green">Where things happen</h1>
        {places.length === 0 ? (
          <p className="mt-4 font-dm-sans text-[17px] text-forest-green/80">No places named yet. Log it can add one with the first entry.</p>
        ) : (
          <Card shadow="soft" className="mt-4 divide-y divide-forest-green/10 px-5">
            {places.map(p => (
              <Link key={p.id} href={`/places/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 py-3">
                <span className="font-dm-sans text-[17px] font-semibold text-forest-green">{p.name}</span>
                <span className="font-dm-sans text-[15px] text-forest-green/80">{p.kind}</span>
              </Link>
            ))}
          </Card>
        )}
      </main>
    </>
  )
}

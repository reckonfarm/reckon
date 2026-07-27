import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { flagDisabled } from '@/lib/flags'
import RadarClient from './RadarClient'

// Hay Radar requires a (free) account — gated server-side, mirroring /profile.
export default async function RadarPage() {
  if (flagDisabled('marketplace')) notFound()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/radar')

  return <RadarClient />
}

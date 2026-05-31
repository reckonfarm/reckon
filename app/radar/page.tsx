import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import RadarClient from './RadarClient'

// Hay Radar requires a (free) account — gated server-side, mirroring /profile.
export default async function RadarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  return <RadarClient />
}

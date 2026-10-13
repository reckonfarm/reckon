import 'server-only'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { getRanch } from '@/lib/ranch-membership'

// ─── "{Section} · {Ranch}" (Block 6A) ─────────────────────────────────────────
// Every private page is titled by its section and the ranch: "Today · Kiehl
// Ranch", "Cattle · Kiehl Ranch", "Home pasture · Kiehl Ranch". Never a county:
// the county title belongs to /dashboard?fips= alone. A person with no ranch
// gets the bare section.
export async function privateTitle(section: string): Promise<Metadata> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ranch = user ? await getRanch(supabase, user.id).catch(() => null) : null
  // Block 49 (R2): signed out, a private page shows the example ranch — titled
  // by the section alone, and kept out of search engines.
  if (!user) return { title: section, robots: { index: false, follow: false } }
  return { title: ranch?.name ? `${section} · ${ranch.name}` : section }
}

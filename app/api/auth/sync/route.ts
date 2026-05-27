import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const db = createServiceClient()
  await db.from('profiles').upsert(
    { id: user.id, email: user.email! },
    { onConflict: 'id' },
  )

  return NextResponse.json({ ok: true })
}

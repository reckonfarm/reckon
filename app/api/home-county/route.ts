import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getHomeCountyFips, setHomeCountyFips } from '@/lib/concierge-service'

async function getAuthUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { id: user.id, email: user.email ?? '' }
}

// GET /api/home-county → { fips: string | null }
export async function GET() {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const fips = await getHomeCountyFips(user.id)
    return Response.json({ fips })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

// POST /api/home-county  { fips }  → sets (replaces) the home county
export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const fips = body?.fips

  if (typeof fips !== 'string' || !/^\d{5}$/.test(fips)) {
    return Response.json({ error: 'fips (5-digit string) is required' }, { status: 400 })
  }

  try {
    await setHomeCountyFips(user.id, user.email, fips)
    return Response.json({ ok: true, fips })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

// DELETE /api/home-county → clears the home county
export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    await setHomeCountyFips(user.id, user.email, null)
    return Response.json({ ok: true, fips: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

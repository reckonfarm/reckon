import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const search = searchParams.get('search')?.trim()
  const state  = searchParams.get('state')?.trim().toUpperCase()

  // Require at least one filter — never dump all 3 k+ rows to the client
  if (!search && !state) {
    return Response.json([])
  }

  const db = createServiceClient()

  let query = db
    .from('counties')
    .select('id, fips, name, state')
    .order('name')
    .limit(30)

  if (search) {
    // Numeric input → search FIPS prefix; otherwise search name (case-insensitive)
    if (/^\d+$/.test(search)) {
      query = query.or(`fips.ilike.${search}%,name.ilike.%${search}%`)
    } else {
      query = query.ilike('name', `%${search}%`)
    }
  }

  if (state) {
    query = query.eq('state', state)
  }

  const { data, error } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}

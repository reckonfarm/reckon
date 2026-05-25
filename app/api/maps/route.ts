import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export interface OfficialMapRecord {
  id: number
  map_type: string
  scope: string | null
  release_date: string
  image_url: string
  source_url: string
  created_at: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const scope = searchParams.get('scope')

  if (!type) {
    return NextResponse.json({ error: 'type is required' }, { status: 400 })
  }

  const db = createServiceClient()
  let query = db
    .from('official_maps')
    .select('id, map_type, scope, release_date, image_url, source_url, created_at')
    .eq('map_type', type)
    .order('release_date', { ascending: false })
    .limit(1)

  if (scope) {
    query = query.eq('scope', scope)
  } else {
    query = query.is('scope', null)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ map: data ?? null, fallback: data === null })
}

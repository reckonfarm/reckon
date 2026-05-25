import { supabase } from '@/lib/supabase'

export async function GET() {
  const { count, error } = await supabase
    .from('counties')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, counties_count: count })
}

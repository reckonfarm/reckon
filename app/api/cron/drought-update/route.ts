import type { NextRequest } from 'next/server'
import { fetchAndStoreDroughtData } from '@/lib/drought-service'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await fetchAndStoreDroughtData()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

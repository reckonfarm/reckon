import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
type Sentiment = (typeof SENTIMENTS)[number]

const MESSAGE_MAX = 2000

// Optional auth: capture user_id if a session exists, but never reject anon.
async function getOptionalUserId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

// POST /api/feedback — accepts feedback from anyone (logged in or not).
// Requires at least one of { sentiment, message }.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const rawSentiment = typeof body.sentiment === 'string' ? body.sentiment : null
  const sentiment: Sentiment | null =
    rawSentiment && (SENTIMENTS as readonly string[]).includes(rawSentiment)
      ? (rawSentiment as Sentiment)
      : null

  const message =
    typeof body.message === 'string' ? body.message.trim().slice(0, MESSAGE_MAX) : ''

  if (!sentiment && !message) {
    return Response.json(
      { error: 'Pick a sentiment or leave a note.' },
      { status: 400 },
    )
  }

  const page_path = typeof body.page_path === 'string' ? body.page_path.slice(0, 512) : null
  const url = typeof body.url === 'string' ? body.url.slice(0, 2048) : null
  // user_agent is captured server-side, never trusted from the client body.
  const user_agent = request.headers.get('user-agent')?.slice(0, 1024) ?? null

  const user_id = await getOptionalUserId()

  const db = createServiceClient()
  const { error } = await db.from('feedback').insert({
    user_id,
    sentiment,
    message: message || null,
    page_path,
    url,
    user_agent,
  })

  if (error) {
    return Response.json({ error: 'Could not save feedback' }, { status: 500 })
  }

  return Response.json({ ok: true })
}

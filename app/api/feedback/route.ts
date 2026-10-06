import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { sendSomethingWrong } from '@/lib/email'

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
type Sentiment = (typeof SENTIMENTS)[number]

const MESSAGE_MAX = 2000

// Optional auth: capture user_id if a session exists, but never reject anon.
async function getOptionalUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user ? { id: user.id, email: user.email ?? null } : null
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

  // Session 1 (1): what they were looking at — the painted text of the screen —
  // rides along to PK's inbox. It is not kept in the table (the table keeps
  // the words and where); the email is the delivery.
  const screen_text = typeof body.screen_text === 'string' ? body.screen_text.slice(0, 4000) : ''
  const screen_width = typeof body.screen_width === 'number' ? body.screen_width : null
  const standalone = body.standalone === true
  const user = await getOptionalUser()
  const user_id = user?.id ?? null

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

  // The same minute, by email — the words first, then the screen. A mail that
  // fails is logged and never fails the send: the row is already kept.
  if (message) {
    await sendSomethingWrong({ from: user?.email ?? null, words: message, pagePath: page_path, url, screenText: screen_text, userAgent: user_agent, screenWidth: screen_width, standalone })
      .catch(e => console.error('[feedback] email failed:', e instanceof Error ? e.message : e))
  }
}

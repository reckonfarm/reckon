import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// ─── /start — where the installed app opens (Block 48, ruling R3) ─────────────
// The manifest's start_url. A home-screen launch lands where the person works:
// signed in, Today; signed out, Markets (public, and the Markets tab is the one
// a stranger came for). The ?source=pwa the manifest adds is for the analytics
// line only; nothing branches on it. With no signal the service worker answers
// this navigation with the last Today it kept, the same as any other.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return NextResponse.redirect(`${origin}${user ? '/today' : '/markets'}`, 307)
}

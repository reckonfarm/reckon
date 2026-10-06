import { cookies } from 'next/headers'
import SiteHeader from './SiteHeader'

// ─── The header, with its signed-in state known before the first paint ───────
// Session 1 (3): the header is a client component, so the server painted it
// signed-out — "Sign in" in the corner of a signed-in member's own Places page
// until the browser read the session and swapped the word. The server does
// know: a Supabase session leaves its auth cookie on the request. Its presence
// paints Account from the first byte; the client still confirms, and a cookie
// without a session goes back to Sign in the moment the browser knows.
export default async function SiteHeaderServer({ center }: { center?: React.ReactNode }) {
  const jar = await cookies()
  const signedIn = jar.getAll().some(c => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value.length > 0)
  return <SiteHeader center={center} signedIn={signedIn} />
}

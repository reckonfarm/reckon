// ─── Kill every upstream, keep the ranch's records ───────────────────────────
// Preloaded into a LOCAL `next start` with
//   NODE_OPTIONS="--import ./scripts/lib/block-upstream.mjs" npx next start -p 3100
// so Block A's falsifier can run as written: with every fetch that is not the
// ranch's own database rejected, Today must still paint the ranch and every
// tap must work. Next wraps whatever globalThis.fetch is when it boots, so this
// runs first. Allowed: the Supabase project (records, auth), this server
// itself. Everything else rejects at once, and each blocked host is named on
// stderr once, so the run can say what it blocked.
import { readFileSync, existsSync } from 'node:fs'
// This runs before Next loads .env.local, so the project's host is read from
// the file itself when the environment does not carry it yet.
function supabaseHost() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue
    const m = /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(\S+)/m.exec(readFileSync(f, 'utf8'))
    if (m) { url = m[1].replace(/^["']|["']$/g, ''); break }
  }
  if (!url) throw new Error('block-upstream: NEXT_PUBLIC_SUPABASE_URL is not set and not in .env.local — refusing to guess what the ranch\'s database is')
  return new URL(url).host
}
const allow = [supabaseHost(), 'localhost', '127.0.0.1']
const seen = new Set()
const real = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url ?? ''
  let host = ''
  try { host = new URL(url).host } catch { return real(input, init) }
  if (allow.some(a => host === a || host.endsWith(':3100') || host.startsWith('localhost'))) return real(input, init)
  if (!seen.has(host)) { seen.add(host); process.stderr.write(`[block-upstream] refused ${host}\n`) }
  throw new TypeError(`fetch failed: ${host} is blocked (block-upstream)`)
}
process.stderr.write(`[block-upstream] active — only ${allow.join(', ')} may be fetched\n`)

import { redirect } from 'next/navigation'

// ─── /ranch/preg-check (Block 10 → Block 15) ──────────────────────────────────
// The chute is a sheet inside the record sheet now, so it opens with no
// signal: this page only sends an old link to Today with the sheet asked for.
export const dynamic = 'force-dynamic'
export default function PregCheckPage() {
  redirect('/today?record=preg_check')
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── What I'm selling (Block 40) ─────────────────────────────────────────────
// Markets prices the bunches on this list and nothing else. One row per live
// bunch — name · class · head — and the row is the control: tap follows, tap
// again unfollows, saved to the ranch as you go. With nothing followed the list
// stands open where the price would be; with bunches followed it folds to one
// line that says how many and opens on a tap.

export default function FollowedBunches({ lots, followed }: { lots: { id: string; label: string }[]; followed: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(followed.length === 0)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const set = new Set(followed)

  const toggle = async (id: string) => {
    if (busy) return
    setBusy(id); setFailed(null)
    try {
      const r = await fetch('/api/herd/follow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lot_id: id, followed: !set.has(id) }) })
      if (!r.ok) throw new Error(String(r.status))
      router.refresh()
    } catch {
      setFailed(id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="following-h" data-audit="followed-bunches" data-open={open ? 'true' : 'false'}>
      <h2 id="following-h" className={`${EYEBROW} !text-ink`}>What I&apos;m selling</h2>
      <Card shadow="none" className="mt-2 px-5 py-2">
        {lots.length === 0 ? (
          <p className="flex min-h-[48px] items-center justify-between gap-3 font-dm-sans text-[17px] text-ink" data-audit="followed-none">
            <span>No bunches yet</span>
            <Link href="/ranch" className="font-semibold text-brand underline underline-offset-2">New bunch</Link>
          </p>
        ) : (
          <>
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left font-dm-sans text-[17px] text-ink" data-audit="followed-line">
              <span>{followed.length === 0 ? 'Pick what you’ll sell' : `${followed.length} of ${lots.length} ${lots.length === 1 ? 'bunch' : 'bunches'}`}</span>
              <span aria-hidden className="text-secondary-ink">{open ? '▴' : '▾'}</span>
            </button>
            {open && (
              <ul className="divide-y divide-rule border-t border-rule" data-audit="followed-rows">
                {lots.map(l => {
                  const on = set.has(l.id)
                  return (
                    <li key={l.id}>
                      <button type="button" role="switch" aria-checked={on} disabled={busy === l.id} onClick={() => void toggle(l.id)}
                        className="flex min-h-[56px] w-full items-center justify-between gap-3 text-left font-dm-sans text-[17px] text-ink"
                        data-audit="followed-row" data-id={l.id} data-on={on ? 'true' : 'false'}>
                        <span className="min-w-0 truncate">{l.label}</span>
                        <span className="shrink-0 tabular-nums">
                          {failed === l.id ? <span className="text-rust" data-audit="followed-failed">Couldn&apos;t send</span> : <span aria-hidden className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${on ? 'border-forest-green bg-forest-green text-white' : 'border-control-border text-transparent'}`}>✓</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </Card>
    </section>
  )
}

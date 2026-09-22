'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import BottomSheet from '@/app/components/BottomSheet'

// ─── Press and hold on any row → Fix · Delete (Block 12 12.3, Block 13) ───────
// One gesture everywhere: an entry, a place, a bunch, a device, a machine
// session, a county on the watchlist, a person, an invitation, a row in the
// trash. Hold a row 400 ms and a sheet names the row and offers the things a
// person does to it, in words. The row itself still taps to open — this wraps
// a row, it does not replace its link.
//
// Desktop: RIGHT-CLICK opens the same sheet, and a ⋯ appears at the row's
// right edge on hover for people who never right-click. Its accessible name
// is plain "Actions" — the row's own words are the sheet's heading, and a
// label that quoted them ("Actions for fed 1 bale to…") answered to every
// form field called "To" on the same page.
//
// BLOCK 13 — three rules this component now holds for every row:
//
//   NEVER A DEAD END. Fix is shown only when it will do something. When it
//   cannot, the row says why in one plain sentence where the button would be
//   ("This one was already replaced.") — never a greyed button, never a route
//   to a page with nothing open on it. The row decides; this renders.
//
//   A HOLD IS FELT. On phones that can, the hold buzzes once (navigator.
//   vibrate) so it is felt through a glove. iOS Safari has no vibration API
//   and gives nothing here; the sheet itself is the signal there.
//
//   A HOLD NEVER STARTS THE PHONE'S OWN MENU. Every row is a link, and iOS
//   answers a long press on a link with its own callout and text selection —
//   which is exactly what this gesture is not. The wrapper turns both off
//   (-webkit-touch-callout: none, user-select: none) for the whole row. A hold
//   that turns into a scroll cancels clean: the timer dies on the first ten
//   pixels of movement.
//
// The row says what Fix and Delete mean for it by passing an href or a
// callback per action; this component owns the gesture and the sheet, nothing
// else.

const HOLD_MS = 400
const MOVE_TOLERANCE_PX = 10

export interface RowAction {
  /** Words on the button: "Fix", "Delete", "Put it back", "Make it my home county". */
  label?: string
  href?: string
  onSelect?: () => void | Promise<void>
}

export interface RowActionLinks {
  /** Names the row in the sheet: "Fed 4 bales", "Watergap", "Cull cows". */
  label: string
  /** The row's own page. Absent = no Open (a row in the trash has no page). */
  openHref?: string | null
  /** Fix. Absent = no button; then `fixNote` says why, if there is a why. */
  fix?: RowAction | null
  /** One plain sentence in place of Fix when fixing will not do anything. */
  fixNote?: string | null
  /** Delete. Absent = no button; then `deleteNote` says why. */
  del?: RowAction | null
  deleteNote?: string | null
  /** One plain sentence ABOVE Delete, before the tap, when this delete is not like the others (a removed person is not in the trash). */
  deleteWarning?: string | null
  /** Other things this row can do: "Make it my home county", "Make owner". */
  extra?: RowAction[]
  /** Block 12 spellings, still honoured: editHref → fix, deleteHref → del. */
  editHref?: string | null
  deleteHref?: string | null
}

const BTN = 'min-h-[56px] w-full rounded-lg border px-4 text-left font-dm-sans text-[17px] font-semibold'

export default function RowActions({ links, children, className = '' }: { links: RowActionLinks; children: ReactNode; className?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const fix = links.fix ?? (links.editHref ? { href: links.editHref } : null)
  const del = links.del ?? (links.deleteHref ? { href: links.deleteHref } : null)

  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }

  // Hold, without drifting: a scroll is not a hold.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    fired.current = false
    start.current = { x: e.clientX, y: e.clientY }
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      try { (navigator as { vibrate?: (p: number) => boolean }).vibrate?.(30) } catch { /* not every phone */ }
      setOpen(true)
    }, HOLD_MS)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    if (Math.abs(e.clientX - start.current.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - start.current.y) > MOVE_TOLERANCE_PX) clear()
  }
  const onPointerUp = () => { clear(); start.current = null }
  // A held row must not ALSO navigate when the finger lifts.
  const onClickCapture = (e: React.MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false } }
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); setOpen(true) }

  useEffect(() => () => clear(), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const go = async (a: RowAction) => {
    if (a.onSelect) {
      setBusy(true)
      try { await a.onSelect() } finally { setBusy(false); setOpen(false) }
      return
    }
    setOpen(false)
    if (!a.href) return
    // A Fix that lands on THIS page with a hash (#fix-<id> on the devices
    // list) must reach the form that is already mounted: router.push only
    // rewrites the URL, and no effect re-runs. Setting the hash fires
    // hashchange, which the forms listen for.
    const hashAt = a.href.indexOf('#')
    if (hashAt > 0 && typeof window !== 'undefined' && a.href.slice(0, hashAt) === window.location.pathname) {
      window.location.hash = a.href.slice(hashAt)
      return
    }
    router.push(a.href)
  }

  return (
    <div
      className={`group relative select-none [-webkit-touch-callout:none] ${className}`}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture} onContextMenu={onContextMenu}
      data-audit="row-actions"
    >
      {children}
      {/* Desktop: a ⋯ at the row's right edge on hover — the same sheet. */}
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        aria-label="Actions"
        title={`Actions for ${links.label}`}
        data-audit="row-more"
        className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-secondary-ink hover:bg-forest-green/5 md:group-hover:inline-flex"
      >
        ⋯
      </button>

      {open && (
        <BottomSheet open onClose={() => { if (!busy) setOpen(false) }} label={`Actions for ${links.label}`} audit="row-actions-sheet">
            <p className="font-dm-sans text-[16px] font-semibold text-ink" data-audit="row-actions-label">{links.label}</p>
            <div className="mt-3 grid gap-2">
              {links.openHref && (
                <button type="button" disabled={busy} onClick={() => void go({ href: links.openHref! })} className={`${BTN} border-control-border bg-surface text-ink disabled:opacity-50`} data-audit="row-action-open">Open</button>
              )}
              {fix ? (
                <button type="button" disabled={busy} onClick={() => void go(fix)} className={`${BTN} border-control-border bg-surface text-ink disabled:opacity-50`} data-audit="row-action-fix">{fix.label ?? 'Fix'}</button>
              ) : links.fixNote ? (
                <p className="min-h-[56px] rounded-lg bg-forest-green/[0.06] px-4 py-3 font-dm-sans text-[16px] leading-snug text-ink" data-audit="row-action-fix-note">{links.fixNote}</p>
              ) : null}
              {(links.extra ?? []).map((a, i) => (
                <button key={i} type="button" disabled={busy} onClick={() => void go(a)} className={`${BTN} border-control-border bg-surface text-ink disabled:opacity-50`} data-audit="row-action-extra">{a.label}</button>
              ))}
              {del && links.deleteWarning && (
                <p className="rounded-lg bg-rust/[0.08] px-4 py-3 font-dm-sans text-[16px] leading-snug text-ink" data-audit="row-action-delete-warning">{links.deleteWarning}</p>
              )}
              {del ? (
                <button type="button" disabled={busy} onClick={() => void go(del)} className={`${BTN} border-rust/40 bg-surface text-rust disabled:opacity-50`} data-audit="row-action-delete">{busy ? 'Deleting…' : (del.label ?? 'Delete')}</button>
              ) : links.deleteNote ? (
                <p className="min-h-[56px] rounded-lg bg-forest-green/[0.06] px-4 py-3 font-dm-sans text-[16px] leading-snug text-ink" data-audit="row-action-delete-note">{links.deleteNote}</p>
              ) : null}
            </div>
        </BottomSheet>
      )}
    </div>
  )
}

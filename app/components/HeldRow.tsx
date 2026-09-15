'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import RowActions, { type RowAction } from './RowActions'
import { deleteWithUndo, callDelete, restoreFromTrash, showNotice } from '@/lib/undo'

// ─── A held row, described in data (Block 13) ─────────────────────────────────
// Server-rendered lists cannot hand a client component a function, so a row
// describes its Delete in data — what kind of thing it is and its id — and
// this component turns that into the one delete every row makes: the call,
// then "Deleted · Undo" for ten seconds. Every kind of row deletes the same
// way; only the route and the way back differ, and both are listed here once.
//
//   event   DELETE /api/activity/[id]/delete   back: POST /api/trash events
//   place   DELETE /api/places/[id]            back: POST /api/trash places
//   device  DELETE /api/devices/[id]           back: POST /api/trash devices
//   lot     DELETE /api/herd/lots/[id]         back: POST /api/trash herd_lots
//   job     PATCH  …/annotation dismissed      back: POST /api/trash jobs
//
// Fix is an href (a page with the form already open), a note, or nothing.

export type DeleteKind = 'event' | 'place' | 'device' | 'lot' | 'job'

export interface HeldRowDelete { kind: DeleteKind; id: string; after?: string | null }

const DELETES: Record<DeleteKind, { run: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>; table: string }> = {
  event:  { run: id => callDelete(`/api/activity/${id}/delete`, { method: 'DELETE' }), table: 'events' },
  place:  { run: id => callDelete(`/api/places/${id}`, { method: 'DELETE' }), table: 'places' },
  device: { run: id => callDelete(`/api/devices/${id}`, { method: 'DELETE' }), table: 'devices' },
  lot:    { run: id => callDelete(`/api/herd/lots/${id}`, { method: 'DELETE' }), table: 'herd_lots' },
  job:    { run: id => callDelete(`/api/jobs/${id}/annotation`, { method: 'PATCH', body: JSON.stringify({ dismissed: true }) }), table: 'jobs' },
}

export default function HeldRow({ label, openHref, fixHref, fixNote, del, deleteNote, extra, className, children }: {
  label: string
  openHref?: string | null
  fixHref?: string | null
  fixNote?: string | null
  del?: HeldRowDelete | null
  deleteNote?: string | null
  extra?: { label: string; href: string }[]
  className?: string
  children: ReactNode
}) {
  const router = useRouter()
  const delAction: RowAction | null = del ? {
    label: 'Delete',
    onSelect: async () => {
      const d = DELETES[del.kind]
      const r = await deleteWithUndo({ label, run: () => d.run(del.id), undo: restoreFromTrash(d.table, del.id), after: del.after })
      if (r.ok) {
        // The row is gone from the list behind the sheet; a page ABOUT the
        // row goes back to its list. Either way the server re-renders.
        if (del.after) router.push(del.after)
        router.refresh()
      } else {
        // A refusal is a sentence on the strip, never a silent no and never a
        // browser dialog.
        showNotice(r.error)
      }
    },
  } : null
  return (
    <RowActions className={className} links={{
      label,
      openHref: openHref ?? null,
      fix: fixHref ? { href: fixHref } : null,
      fixNote: fixHref ? null : fixNote ?? null,
      del: delAction,
      deleteNote: delAction ? null : deleteNote ?? null,
      extra: (extra ?? []).map(e => ({ label: e.label, href: e.href })),
    }}>
      {children}
    </RowActions>
  )
}

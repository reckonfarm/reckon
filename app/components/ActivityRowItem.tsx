import Link from 'next/link'
import HeldRow from './HeldRow'
import type { ReactNode } from 'react'

// ─── One activity row, everywhere (Block 6 · 6B) ──────────────────────────────
// Every timeline — the Activity record, a place, the Ranch hub, Today's
// Activity tab, "Recorded since you checked" — renders an event through this
// one component, so a corrected or voided entry is marked the same way
// wherever it appears. The Sept 8 audit read a place timeline with the
// original "Fed 2 bales" and the correction "Fed 1 bale" as two ordinary rows
// at the same minute: two feedings.
//   operational lists → what STANDS: the effective event, marked "corrected"
//                       when it replaced something, with what it replaced one
//                       tap away (a native <details>, no script); and a VOID,
//                       greyed and marked "voided" — it counts toward no
//                       balance, and it stays findable (PK, Sept 8: a hand who
//                       logged it must never find his entry gone with no
//                       explanation; "caught up" never means an entry vanished)
//   audit history     → every revision: a replaced original struck through
//                       and marked "replaced"; the row that replaced it
//                       "corrected"; a void "voided"
// The row opens ITS event by stable id. Nothing here recomputes a value.

export type RowMarker = 'corrected' | 'replaced' | 'voided' | null
export interface ChainStep { id: string; line: string; who: string; when: string; reason: string | null }

export function markerFor(r: { supersedes_event_id?: string | null; superseded_by?: string | null; voided_at?: string | null }): RowMarker {
  if (r.voided_at) return 'voided'
  if (r.superseded_by) return 'replaced'
  if (r.supersedes_event_id) return 'corrected'
  return null
}

// Block 12 (12.5): the WORD a person reads. 'voided' stays as the data value
// (data-marker, the 054 column, the suites) because it is a fact about the
// row; "removed" is what it means to the person reading the list. Delete's
// record path and a 054 void look the same from the outside: it no longer
// counts, and what it took out is one tap away.
const MARKER_WORD: Record<Exclude<RowMarker, null>, string> = { corrected: 'corrected', replaced: 'replaced', voided: 'removed' }
const MARKER_AUDIT: Record<Exclude<RowMarker, null>, string> = { corrected: 'row-correction', replaced: 'row-superseded', voided: 'row-voided' }
const MARKER_TITLE: Record<Exclude<RowMarker, null>, string> = {
  corrected: 'This entry replaced an earlier one',
  replaced: 'An earlier value — a later entry replaced it',
  voided: 'Removed — it no longer counts',
}

export default function ActivityRowItem({ id, who, line, when, marker, chain, aside, audit = 'activity-row', rowClass = 'px-4 py-3', sep = ' · ', href }: {
  id: string
  who?: string | null
  line: string
  when: string
  marker: RowMarker
  chain?: ChainStep[]       // operational lists: what a corrected entry replaced (empty = older than this list)
  aside?: ReactNode         // a second link under the row (a place, say) — never inside the row's own link
  audit?: string
  rowClass?: string
  sep?: string              // between who and the line: ' · ' for a labelled row, ' ' for a sentence ("Smoke A fed 2 bales")
  href?: string             // 6J: machine work opens its job (/jobs/[id]) — the same row, a different record
}) {
  const struck = marker === 'replaced'
  const greyed = marker === 'voided'
  return (
    <li data-marker={marker ?? 'none'} data-id={id}>
      {/* Block 13: hold the row for Fix · Delete. Fix is offered only when it
          will do something: a standing entry opens its correction form; a
          machine session opens its own page with the name form open. A row
          that was replaced or removed gets the sentence instead of a button.
          Delete goes straight to the trash with a ten-second Undo. */}
      <HeldRow
        label={line}
        openHref={href ?? `/ranch/activity/${id}`}
        fixHref={href ? `${href}#fix` : marker === null || marker === 'corrected' ? `/ranch/activity/${id}#correct` : null}
        fixNote={marker === 'replaced' ? 'This one was already replaced. Fix the newer entry instead.' : marker === 'voided' ? 'This one was removed. There is nothing left to fix.' : null}
        del={href ? { kind: 'job', id } : marker === 'voided' ? null : { kind: 'event', id }}
        deleteNote={!href && marker === 'voided' ? 'This one is already removed.' : null}
      >
      <Link href={href ?? `/ranch/activity/${id}`} className={`flex min-h-[56px] flex-col items-start gap-0.5 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between min-[360px]:gap-3 hover:bg-forest-green/[0.03] ${rowClass}`} data-audit={audit}>
        <span className={`min-w-0 font-dm-sans text-[17px] leading-snug ${greyed ? 'text-secondary-ink' : 'text-ink'}`}>
          {who ? <><span className="font-semibold">{who}</span>{sep}</> : null}
          {struck ? <s className="decoration-2">{line}</s> : line}
          {marker && <span className="ml-2 font-dm-sans text-[14px] font-semibold text-secondary-ink" title={MARKER_TITLE[marker]} data-audit={MARKER_AUDIT[marker]}>{MARKER_WORD[marker]}</span>}
        </span>
        <span className="shrink-0 font-dm-sans text-[15px] tabular-nums text-secondary-ink">{when}</span>
      </Link>
      </HeldRow>
      {aside}
      {(marker === 'corrected' || marker === 'voided') && chain && (
        <details className={`pb-3 ${rowClass.includes('px-4') ? 'px-4' : ''}`} data-audit="row-chain">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center font-dm-sans text-[15px] font-semibold text-brand underline underline-offset-2">{marker === 'voided' ? 'What it removed' : 'What it replaced'}</summary>
          {chain.length === 0 ? (
            <p className="font-dm-sans text-[15px] text-secondary-ink">The entry it replaced is older than this list — open the entry for the whole chain.</p>
          ) : (
            <ol className="space-y-1">
              {chain.map(c => (
                <li key={c.id} className="font-dm-sans text-[15px] text-secondary-ink"><s className="decoration-2">{c.line}</s> · {c.who} · {c.when}{c.reason ? ` — ${c.reason}` : ''}</li>
              ))}
            </ol>
          )}
        </details>
      )}
    </li>
  )
}

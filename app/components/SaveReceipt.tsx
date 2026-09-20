import Link from 'next/link'

// ─── One save receipt (Block 5C) ──────────────────────────────────────────────
// Every save says the same three things in the same shape, wherever it lands:
// what was recorded, what it meant (the answer lines from lib/log-consequence,
// only when the server has said), and the exact entry, one tap away. Used by
// the status strip under Log it and Repeat last (a synced entry) and by the
// event page after a correction or a void. No other receipt pattern exists.

export interface SaveReceiptProps {
  headline: string             // "Synced to ranch" · "Saved"
  label: string                // what was recorded: "Fed 4 bales to Steer calves at Home pasture"
  lines?: string[]             // what it meant, in order
  /** Block 23: the transient strip — one line and nothing else. */
  compact?: boolean
  eventId?: string | null      // the exact entry; omitted when the receipt IS the entry's page
  eventLabel?: string          // link words, default "Open this entry"
  href?: string | null         // Block 7A: where the link goes when the thing saved is not an entry (a place)
  tone?: 'plain' | 'strip'     // strip = inside the status strip (no own box)
}

export default function SaveReceipt({ headline, label, lines = [], eventId, eventLabel = 'Open this entry', href, tone = 'plain', compact = false }: SaveReceiptProps) {
  const to = href ?? (eventId ? `/ranch/activity/${eventId}` : null)
  const box = tone === 'plain' ? 'rounded-lg bg-forest-green/[0.06] px-4 py-3' : ''

  // Block 23 (rulings 3 and 4) — THE TRANSIENT RECEIPT IS ONE LINE AND UNDO.
  // It is read at arm's length in a corral, in gloves and sun, by someone whose
  // attention is on cattle: "220 → 198, 22 to Fall Cows". The label, the
  // arithmetic fold and the link to the entry all come off — anyone who wants
  // the detail opens the record, and this is not the moment they will. Big and
  // dark, because a thin green line at 17px is unreadable on a bright day.
  if (compact) {
    return (
      <div className={`font-dm-sans ${box}`} data-audit="save-receipt" data-compact="true">
        <p className="text-[15px] font-semibold uppercase tracking-wide text-forest-green/80" data-audit="receipt-headline">{headline}</p>
        <p className="mt-0.5 text-[22px] font-semibold leading-tight text-ink" data-audit="receipt-balance">{lines[0] ?? label}</p>
        {/* The record's own name stays reachable to anything that needs to know
            WHICH record this is — a screen reader, a check — without spending a
            second line on a screen read at arm's length. */}
        {lines[0] && lines[0] !== label && <span className="sr-only" data-audit="receipt-label-sr">{label}</span>}
      </div>
    )
  }

  return (
    <div className={`font-dm-sans ${box}`} data-audit="save-receipt">
      <p className="text-[17px] font-semibold leading-snug text-forest-green" data-audit="receipt-headline">{headline}</p>
      <p className="mt-0.5 text-[16px] leading-snug text-ink" data-audit="receipt-label">{label}</p>
      {/* Block 11 (11.12): SYNC STATUS, EVENT, BALANCE — and the arithmetic
          one tap away. This was six lines with a full equation in the middle of
          them, at the moment a person most wants a single number: did it save,
          what did I record, what is the balance now. Nothing is dropped; the
          working is behind "How that adds up", where it is checkable and not in
          the way. A receipt with only the balance shows no disclosure at all. */}
      {lines.length > 0 && (
        <div className="mt-2 border-t border-forest-green/10 pt-2" data-audit="receipt-lines">
          <p className="text-[17px] font-semibold text-forest-green" data-audit="receipt-balance">{lines[0]}</p>
          {lines.length > 1 && (
            <details className="mt-1" data-audit="receipt-detail">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[16px] font-semibold text-brand underline underline-offset-2">How that adds up</summary>
              <ul className="mt-1 space-y-1">
                {lines.slice(1).map((l, i) => <li key={i} className="text-[16px] text-ink">{l}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
      {to && (
        <Link href={to} className="mt-2 inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="receipt-open-entry">
          {eventLabel} →
        </Link>
      )}
    </div>
  )
}

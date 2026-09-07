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
  eventId?: string | null      // the exact entry; omitted when the receipt IS the entry's page
  eventLabel?: string          // link words, default "Open this entry"
  tone?: 'plain' | 'strip'     // strip = inside the status strip (no own box)
}

export default function SaveReceipt({ headline, label, lines = [], eventId, eventLabel = 'Open this entry', tone = 'plain' }: SaveReceiptProps) {
  const box = tone === 'plain' ? 'rounded-lg bg-forest-green/[0.06] px-4 py-3' : ''
  return (
    <div className={`font-dm-sans ${box}`} data-audit="save-receipt">
      <p className="text-[17px] font-semibold leading-snug text-forest-green" data-audit="receipt-headline">{headline}</p>
      <p className="mt-0.5 text-[16px] leading-snug text-ink" data-audit="receipt-label">{label}</p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-forest-green/10 pt-2" data-audit="receipt-lines">
          {lines.map((l, i) => <li key={i} className={i === 0 ? 'text-[17px] font-semibold text-forest-green' : 'text-[16px] text-ink'}>{l}</li>)}
        </ul>
      )}
      {eventId && (
        <Link href={`/activity/${eventId}`} className="mt-2 inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="receipt-open-entry">
          {eventLabel} →
        </Link>
      )}
    </div>
  )
}

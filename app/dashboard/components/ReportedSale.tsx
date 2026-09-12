import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import type { LocalAuctionResult } from '@/lib/local-auction-service'
import type { VolumeRow } from '@/lib/trend'
import { reportUrl, saleAge } from '@/lib/market-scope'
import { DISCOVERY_RADIUS_MI, DISTANCE_BASIS } from '@/lib/barn-geo'

// ─── Reported sale — the page's evidence, stated ONCE (Block 7C) ──────────────
//
// The Sep 11 inventory counted "Billings" in 21 text nodes on this page. Six of
// them were the SAME fact — Billings Livestock Commission, Sep 10, reference
// sale of N head — restated as a full evidence line, each with its own Report ↗
// link; seven such links in all, every one pointing at the same report.
//
// This is that fact, once, directly under the hero. Everything downstream now
// refers to it without repeating it: a delta row reads "Steer calves · 180 head
// · 550 lb · ▲ $32.76/cwt since Sep 3" with no trailing barn name, because the
// page has one barn and it is named here.
//
// THE EXCEPTION THAT SURVIVES (6I): a lot priced somewhere other than this barn
// still names its own. The rule is not "never name a barn" — it is "name the
// page's barn once, and name only the departures from it".
//
// It is also NOT a disclosure any more. It used to be "Sale detail ▾", which
// hid the page's central evidence behind a tap while six copies of it sat in
// the open. Unhidden, stated once.
//
// The staleness line is saleAge()'s, which is FRESH_DAYS and ageDays from
// lib/barn-geo — the same rule that decides whether this barn resolves as a
// reference at all.

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtInt = (n: number) => n.toLocaleString('en-US')
const shortTown = (t: string) => t.replace(/,\s*[A-Z]{2}$/, '')
const NO_LOCAL_LINE = `No reporting auction within ${DISCOVERY_RADIUS_MI} ${DISTANCE_BASIS} of the county center`

export default function ReportedSale({ result, volume = null }: { result: LocalAuctionResult; volume?: VolumeRow[] | null }) {
  if (result.status !== 'ok') {
    // The honest states keep their own words; there is no sale to report on.
    return (
      <section aria-labelledby="reported-sale-h" data-audit="reported-sale">
        <h2 id="reported-sale-h" className={`${EYEBROW} !text-ink`}>Reported sale</h2>
        <Card shadow="none" className="mt-2 px-5 py-4">
          <p className="font-dm-sans text-[16px] text-ink" data-audit="reported-sale-none">
            {result.status === 'data_unavailable' && 'Auction data temporarily unavailable — check back shortly.'}
            {result.status === 'no_coverage' && `${NO_LOCAL_LINE} — Montana barns today, expanding.`}
            {result.status === 'no_recent_sale' && `No recent sale reported at ${result.barnName} (${result.town}) — last sale ${fmtDate(result.lastSale)}. Montana barns run lighter summer schedules.`}
          </p>
        </Card>
      </section>
    )
  }

  const age = saleAge(shortTown(result.town), result.saleDate)
  const scope = result.pinned ? 'Preferred sale barn'
    : result.beyondHaul ? 'Regional reference'
    : 'Local report'
  const fallback = result.beyondHaul && !result.pinned
    ? 'Scope: Regional reference · falls back to National reference'
    : 'Scope: Local report · falls back to Regional reference, then National reference'

  return (
    <section aria-labelledby="reported-sale-h" data-audit="reported-sale">
      <h2 id="reported-sale-h" className={`${EYEBROW} !text-ink`}>Reported sale</h2>
      <Card shadow="none" className="mt-2 px-5 py-4">
        {/* Beyond the discovery radius the card says so FIRST (2.6A), before it
            offers the barn as a reference at all. */}
        {result.beyondHaul && !result.pinned && (
          <p className="mb-2 font-dm-sans text-[16px] text-ink">{NO_LOCAL_LINE}.</p>
        )}

        <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="reported-sale-barn">
          {result.barnName} · {fmtDate(result.saleDate)}
        </p>

        <p className="mt-0.5 font-dm-sans text-[16px] text-secondary-ink" data-audit="reported-sale-facts">
          {result.receipts != null ? `${fmtInt(result.receipts)} head · ` : ''}~{result.miles} mi · {scope}
          {' · '}
          <a href={reportUrl(result.slugId)} target="_blank" rel="noopener noreferrer"
            aria-label={`USDA AMS report ${result.slugId} — opens in a new tab`}
            data-audit="report-link"
            className="-my-3 inline-flex min-h-[48px] items-center font-semibold text-forest-green underline underline-offset-2">
            Report ↗
          </a>
        </p>

        {/* How old is this. One statement, beside the figures it dates — not a
            strip of three dates at the top of the page belonging to three
            different sections. */}
        <p
          className={`mt-1 font-dm-sans text-[16px] ${age.stale ? 'font-semibold text-amber-900' : 'text-secondary-ink'}`}
          data-audit="sale-age"
          data-stale={age.stale ? 'true' : 'false'}
        >
          {age.line}
        </p>

        {/* Receipts (6B/6I): the scope before the number — which classes the total
            spans — and the per-class split. No unexplained total. */}
        {result.receipts != null && (
          <div className="mt-2 rounded-lg bg-forest-green/[0.04] px-3 py-2 font-dm-sans text-[15px] text-ink" data-audit="receipts-scope">
            {(() => {
              const known = (volume ?? []).filter(v => v.receipts != null)
              const sum = known.reduce((s, v) => s + (v.receipts ?? 0), 0)
              const names = known.map(v => v.commodity.toLowerCase())
              const across = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
              return known.length > 0
                ? <p><span className="font-semibold">Receipts:</span> {fmtInt(sum)} head across {across} {known.length > 1 ? 'classes' : 'class'}</p>
                : <p><span className="font-semibold">Receipts:</span> {fmtInt(result.receipts!)} head on the {(result.receiptsCommodity ?? 'reported').toLowerCase()} report
                    {result.receiptsWeekAgo != null && <span className="text-secondary-ink"> · {fmtInt(result.receiptsWeekAgo)} a week earlier</span>}</p>
            })()}
            {volume && volume.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-secondary-ink">
                {volume.map(v => (
                  <li key={v.commodity}>
                    {v.commodity}: <span className="tabular-price text-ink">{v.receipts != null ? fmtInt(v.receipts) : '—'}</span> head
                    {v.weekAgo != null && v.receipts != null && <> · {v.receipts - v.weekAgo >= 0 ? '▲ up' : '▼ down'} {fmtInt(Math.abs(v.receipts - v.weekAgo))} vs last week</>}
                    {v.yearAgo != null && <> · {fmtInt(v.yearAgo)} a year ago</>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="mt-2 font-dm-sans text-[14px] text-secondary-ink" data-audit="scope-fallback">{fallback}</p>
      </Card>
    </section>
  )
}

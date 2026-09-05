import type { SupabaseClient } from '@supabase/supabase-js'
import { getHayLedger, type RunOutVerdict } from './hay/queries'
import { getRainLedger } from './rain/queries'
import { fmtDay, plural, ranchYearStart } from './jobs/format'
import type { ManualEventType } from './manual-log'

// ─── Every log returns an answer (Block 2C) ───────────────────────────────────
//
// After a manual entry lands, the server says what it MEANT, in place of a
// receipt: the number recorded, then the state it changed, then — only when
// the ledger's own gates pass — what that state implies. Read on the same
// user-scoped client that wrote the row, so the answer is scoped exactly like
// the ledgers on the page. Never invents: a line is present only when the
// number behind it exists; the projection line follows lib/hay/queries'
// run-out gates (a counted baseline, feeding logged on ≥7 days, a rate in the
// last 14 days) and names the basis it rests on. Empty lines array = nothing
// honest to add beyond the receipt the status strip already shows.

export interface Consequence { lines: string[] }

const bales = (n: number) => plural(n, 'bale')
const ranchDay = (key: string) => fmtDay(`${key}T12:00:00-06:00`)
const fmtRate = (r: number) => (r >= 10 ? r.toFixed(0) : r.toFixed(1))

function runOutLine(runOut: RunOutVerdict): string | null {
  if (!runOut.date) return null
  const b = runOut.basis
  return `About ${plural(runOut.daysLeft, 'feeding day')} left at your recent rate — ${fmtRate(b.balesPerDay)} bales/day over the last ${b.windowDays} days (fed on ${b.daysWithEntries} of them)`
}

export async function consequenceFor(
  supabase: SupabaseClient,
  type: ManualEventType,
  payload: Record<string, unknown>,
  placeName: string | null,
): Promise<Consequence> {
  const lines: string[] = []
  const num = (k: string) => (typeof payload[k] === 'number' && Number.isFinite(payload[k] as number) ? (payload[k] as number) : null)
  const at = placeName ? ` at ${placeName}` : ''

  try {
    switch (type) {
      case 'hay_fed':
      case 'bales_stacked':
      case 'hay_inventory': {
        const n = num(type === 'bales_stacked' ? 'count' : 'bales')
        if (n == null) return { lines }
        if (type === 'hay_fed') lines.push(`${bales(n)} recorded${at}`)
        if (type === 'bales_stacked') lines.push(`${bales(n)} stacked${at}`)
        if (type === 'hay_inventory') lines.push(`${bales(n)} on hand as of ${ranchDay(String(payload.as_of ?? ''))}`)

        const ledger = await getHayLedger(supabase, { since: ranchYearStart() })
        const { onHand, fed, runOut } = ledger.summary
        if (onHand) {
          const b = onHand.baseline
          lines.push(
            onHand.bales < 0
              ? `Hay on hand reads ${onHand.bales.toLocaleString()} — more fed than your ${ranchDay(b.asOf)} count of ${b.bales.toLocaleString()} allows; recount when you can`
              : `${onHand.bales.toLocaleString()} ${onHand.bales === 1 ? 'bale' : 'bales'} on hand (from your count of ${b.bales.toLocaleString()} on ${ranchDay(b.asOf)}, ${onHand.fedSince.bales.toLocaleString()} fed since)`,
          )
        } else if (fed) {
          lines.push(`${fed.bales.toLocaleString()} bales fed over ${plural(fed.days, 'day')} this season — no stack count yet, so no "remaining"`)
        }
        const r = runOutLine(runOut)
        if (r) lines.push(r)
        return { lines }
      }
      case 'rain': {
        const inches = num('inches')
        if (inches == null) return { lines }
        lines.push(`${inches.toFixed(2)}" recorded${at}`)
        const ledger = await getRainLedger(supabase)
        const placeId = typeof payload.place_id === 'string' ? payload.place_id : null
        const group = ledger.places.find(p => p.place_id === placeId) ?? null
        const y = group?.ytd ?? ledger.ytd
        if (y.entries > 1) {
          lines.push(`${y.inches.toFixed(2)}" ${placeName ? `at ${placeName}` : 'on the ranch'} since Jan 1, ${y.year} (${plural(y.entries, 'reading')})`)
        }
        return { lines }
      }
      case 'cattle_moved': {
        const head = num('head')
        if (head == null) return { lines }
        lines.push(`${head.toLocaleString()} head recorded${placeName ? ` moved to ${placeName}` : ''}`)
        return { lines }
      }
      case 'cattle_worked': {
        const head = num('head')
        const what = typeof payload.what === 'string' ? payload.what : ''
        if (head == null) return { lines }
        lines.push(`${head.toLocaleString()} head ${what || 'worked'}${at}`)
        return { lines }
      }
    }
  } catch {
    // The row is saved; a failed read of the ledgers costs the answer, not the entry.
  }
  return { lines }
}

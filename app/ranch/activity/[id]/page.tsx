import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getEvent, describeEvent, type ActivityRow } from '@/lib/activity'
import { fmtDay, fmtTime, dayKey } from '@/lib/jobs/format'
import CorrectionActions from './CorrectionActions'
import { consequenceFor } from '@/lib/log-consequence'
import { isManualEventType } from '@/lib/manual-log'
import SaveReceipt from '@/app/components/SaveReceipt'
import { privateTitle } from '@/lib/private-title'

// ─── /activity/[id] — the exact event (Block 5A) + its correction chain (5B) ──
// Opened by its stable id from a handoff row, a Recently logged row, a place, or
// the record. States the actor and their role, lot, place, quantity with units,
// WORK time and RECORDING time as separate fields (a backdated entry explains
// itself), and sync state. When the entry was corrected or voided, the current
// value is stated first and the original stays readable underneath; when it is
// a correction, it names what it corrects, who changed it, when, and why.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Activity')

const when = (iso: string) => `${fmtDay(iso, 'long')} · ${fmtTime(iso)}`
const editableValues = (r: ActivityRow) => Object.fromEntries(Object.entries(r.payload).filter(([k]) => k !== 'source' && k !== 'schema_version'))

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params
  const { saved } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/ranch/activity/${id}`)}`)
  const ev = await getEvent(supabase, user.id, id)
  if (!ev) notFound()
  const { row, names, actorRole, line, quantity, placeId, lotId, corrects, correctedBy, head, canCorrect } = ev
  const backdated = dayKey(row.ts) !== dayKey(row.ingested_at)
  const placeName = names.place(placeId)
  const lotName = names.lot(lotId)
  const isVoid = Boolean(row.voided_at)
  const isCorrection = Boolean(row.supersedes_event_id) && !isVoid
  const replaced = correctedBy.length > 0
  const original = corrects[0] ?? null
  // The receipt after a correction or void says what the entry MEANS now — the
  // same answer a fresh entry gets (Block 2C), read on the same client, so the
  // resulting balance is on the page the save lands on (gate 4).
  const receipt = saved === '1' && isManualEventType(row.type)
    ? (await consequenceFor(supabase, row.type, row.payload, placeName)).lines.slice(isVoid ? 1 : 0)
    : []

  const rows: [string, React.ReactNode][] = [
    ['Who', <>{names.person(row.user_id)} <span className="text-secondary-ink">· {actorRole}</span></>],
    ['What', line],
    ...(quantity ? [['Quantity', quantity] as [string, React.ReactNode]] : []),
    ...(lotName ? [['Lot', lotName] as [string, React.ReactNode]] : []),
    ...(placeName && placeId ? [['Place', <Link key="p" href={`/ranch/places/${placeId}`} className="font-semibold text-brand underline underline-offset-2">{placeName}</Link>] as [string, React.ReactNode]] : []),
    ['Work time', when(row.ts)],
    ['Recorded', when(row.ingested_at)],
    ['Sync', row.device_id ? 'Received from a device' : 'Synced to ranch'],
    ...(original ? [[isVoid ? 'Voids' : 'Corrects', <Link key="o" href={`/ranch/activity/${original.id}`} className="font-semibold text-brand underline underline-offset-2" data-audit="event-corrects-link"><s>{describeEvent(original, names)}</s></Link>] as [string, React.ReactNode]] : []),
    ...(row.supersedes_event_id ? [['Reason', row.correction_reason?.trim() || <span className="text-secondary-ink">No reason given</span>] as [string, React.ReactNode]] : []),
  ]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>The record · one entry</p>
        <h1 className={`mt-1 type-page-heading text-ink ${replaced ? 'line-through decoration-2' : ''}`} data-audit="event-line">{line}</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">{fmtDay(row.ts, 'long')}, recorded by {names.person(row.user_id)}.</p>

        {saved === '1' && (
          // Block 5C — the same receipt every save gets; this page IS the entry, so the link goes to the one it replaced.
          <div className="mt-3" data-audit="event-saved">
            <SaveReceipt
              headline={isVoid ? 'Saved — entry voided' : 'Saved — entry corrected'}
              label={isVoid ? 'The entry it voids is marked and no longer counts.' : 'This entry now stands; the one it corrects is marked and no longer counts.'}
              lines={receipt}
              eventId={original?.id ?? null}
              eventLabel={isVoid ? 'Open the voided entry' : 'Open the entry it corrects'}
            />
            <span hidden data-audit="event-consequence">{receipt.join(' · ')}</span>
          </div>
        )}

        {replaced && (
          <Card className="mt-4 border-rust/40 p-4" data-audit="event-replaced">
            <p className={EYEBROW}>{head.voided_at ? 'This entry was voided' : 'This entry was corrected'}</p>
            <p className="mt-1 font-dm-sans text-[17px] leading-snug text-ink">
              {head.voided_at ? 'It no longer counts. ' : <>Current: <Link href={`/ranch/activity/${head.id}`} className="font-semibold text-brand underline underline-offset-2" data-audit="event-current-link">{describeEvent(head, names)}</Link>. </>}
              Changed by {names.person(head.user_id)} on {fmtDay(head.ingested_at)} at {fmtTime(head.ingested_at)}{head.correction_reason?.trim() ? ` — ${head.correction_reason.trim()}` : ''}.
            </p>
          </Card>
        )}

        <Card className="mt-4 p-0" data-audit="event-detail">
          <dl className="divide-y divide-rule">
            {rows.map(([k, v]) => (
              <div key={k} className="flex min-h-[52px] items-baseline gap-4 px-4 py-3">
                <dt className="w-28 shrink-0 font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">{k}</dt>
                <dd className="font-dm-sans text-[17px] leading-snug text-ink" data-audit={`event-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {backdated && (
          <p className="mt-3 font-dm-sans text-[16px] leading-snug text-ink" data-audit="event-backdated">
            {isCorrection || isVoid
              ? 'This correction was recorded on a later day than the work it describes. It is news from the day it was recorded, and it belongs to the work day in the record and in every balance.'
              : 'This entry was recorded on a later day than the work it describes. Both dates are shown above; the balance uses the work time.'}
          </p>
        )}

        {(corrects.length > 0 || correctedBy.length > 0) && (
          <Card className="mt-4 p-4" data-audit="event-chain">
            <p className={EYEBROW}>Correction chain · first to current</p>
            <ol className="mt-2 divide-y divide-rule">
              {[...[...corrects].reverse(), row, ...correctedBy].map((r, i, all) => {
                const current = i === all.length - 1
                const me = r.id === row.id
                return (
                  <li key={r.id} className="py-2 font-dm-sans text-[16px] leading-snug text-ink">
                    {me ? <span className={current ? 'font-semibold' : 'line-through'}>{describeEvent(r, names)}</span> : <Link href={`/ranch/activity/${r.id}`} className={`text-brand underline underline-offset-2 ${current ? 'font-semibold' : 'line-through'}`}>{describeEvent(r, names)}</Link>}
                    <span className="block text-[14px] text-secondary-ink">{names.person(r.user_id)} · recorded {fmtDay(r.ingested_at)} {fmtTime(r.ingested_at)}{r.correction_reason?.trim() ? ` · ${r.correction_reason.trim()}` : ''}{current ? ' · current' : ''}{me ? ' · this entry' : ''}</span>
                  </li>
                )
              })}
            </ol>
          </Card>
        )}

        <p className="mt-3 font-dm-sans text-[14px] text-secondary-ink">Entry {row.id}</p>

        {canCorrect && <CorrectionActions event={{ id: row.id, type: row.type, ts: row.ts, values: editableValues(row), reason: row.correction_reason ?? null }} />}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/activity${placeId ? `?place=${placeId}` : ''}`} className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink">{placeName ? `All activity at ${placeName}` : 'All activity'}</Link>
          <Link href="/home" className="inline-flex min-h-[48px] items-center px-2 font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Back to Today</Link>
        </div>
      </main>
    </>
  )
}

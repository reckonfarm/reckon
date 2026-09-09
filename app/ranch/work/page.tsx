import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { privateTitle } from '@/lib/private-title'
import { listWork, type WorkKind } from '@/lib/jobs/work'
import { fmtDay, fmtTime, fmtDuration, dayKey } from '@/lib/jobs/format'
import InProgressBadge from '@/app/jobs/InProgressBadge'

// ─── Ranch → Work (Block 6 · 6J) ──────────────────────────────────────────────
// A section under Ranch, not a fifth tab: the machines' sessions this season
// — cutting and baling first — as rows answering type, time, machine, origin,
// quantity (only when supported), and state. Place is not shown: a job
// carries a bounding box, not a place. Each row opens the job by its stable id.

export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Work')

const KINDS: { key: WorkKind | 'all'; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'cutting', label: 'Cutting' }, { key: 'baling', label: 'Baling' }]
const pick = (v: string | string[] | undefined): WorkKind | 'all' => (v === 'cutting' || v === 'baling' ? v : 'all')

export default async function WorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const kind = pick(sp.kind)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/ranch/work${kind === 'all' ? '' : `?kind=${kind}`}`)}`)
  const res = await listWork(supabase, { kind }).then(rows => ({ ok: true as const, rows })).catch(() => ({ ok: false as const, rows: [] }))
  const rows = [...res.rows.filter(r => !r.minor), ...res.rows.filter(r => r.minor)]
  const anyBaling = res.rows.some(r => r.kind === 'baling')

  const groups: { day: string; rows: typeof rows }[] = []
  for (const r of rows) { const d = dayKey(r.startedAt); const g = groups[groups.length - 1]; if (g && g.day === d) g.rows.push(r); else groups.push({ day: d, rows: [r] }) }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch</p>
        <h1 className="mt-1 type-page-heading text-ink">Work</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">Sessions a Scout observed on a machine this season — cutting and baling — each opening its own record. Work recorded by hand is under <Link href="/ranch/activity" className="font-semibold text-brand underline underline-offset-2">Activity</Link>.</p>

        <nav aria-label="Kind" className="mt-4 flex flex-wrap gap-2" data-audit="work-filters">
          {KINDS.map(k => (
            <Link key={k.key} href={k.key === 'all' ? '/ranch/work' : `/ranch/work?kind=${k.key}`} aria-current={k.key === kind ? 'page' : undefined} data-audit={`work-filter-${k.key}`}
              className={`inline-flex min-h-[48px] items-center rounded-lg border px-4 font-dm-sans text-[16px] font-semibold ${k.key === kind ? 'border-forest-green bg-forest-green text-cream' : 'border-control-border bg-surface text-ink hover:bg-forest-green/5'}`}>
              {k.label}
            </Link>
          ))}
        </nav>

        {anyBaling && (
          <p className="mt-3 font-dm-sans text-[15px] text-secondary-ink" data-audit="stock-rule">
            Bales a Scout counts are bales <span className="font-semibold text-ink">made</span>, not stacked. The Hay balance counts only what you record as stacked, sold or fed — a Scout count never enters it, so recording the stack does not double anything.
          </p>
        )}

        {!res.ok ? (
          <Card className="mt-4 p-5" data-audit="work-failed"><p className="font-dm-sans text-[17px] text-ink">Work couldn’t be read just now. Try again in a moment.</p></Card>
        ) : rows.length === 0 ? (
          <Card className="mt-4 p-5" data-audit="work-empty">
            <p className="font-dm-sans text-[17px] text-ink">{kind === 'all' ? 'No machine work this season.' : `No ${kind} recorded by a machine this season.`}</p>
            <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">A Scout on a machine records cutting and baling here. <Link href="/ranch/devices" className="font-semibold text-brand underline underline-offset-2">Devices →</Link></p>
          </Card>
        ) : groups.map(g => (
          <section key={g.day} className="mt-5" aria-label={fmtDay(`${g.day}T12:00:00-06:00`, 'long')}>
            <h2 className="font-dm-sans text-[16px] font-semibold uppercase tracking-wide text-secondary-ink">{fmtDay(`${g.day}T12:00:00-06:00`, 'long')}</h2>
            <Card className="mt-2 p-0">
              <ol className="divide-y divide-rule" data-audit="work-list">
                {g.rows.map(r => (
                  <li key={r.id} data-kind={r.kind} data-id={r.id}>
                    <Link href={`/jobs/${r.id}`} className="block px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="work-row">
                      <p className="flex flex-wrap items-center gap-2 font-dm-sans text-[17px] font-semibold text-ink">
                        <span data-audit="work-type">{r.name ?? (r.kind === 'session' ? 'Machine session' : r.kind === 'baling' ? 'Baling' : 'Cutting')}</span>
                        {r.inProgress ? <InProgressBadge /> : <span className="rounded-full bg-forest-green/10 px-2 py-0.5 font-dm-sans text-[13px] font-semibold text-forest-green" data-audit="work-state">ended</span>}
                        {r.minor && <span className="font-dm-sans text-[14px] font-medium text-secondary-ink">short session</span>}
                      </p>
                      <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink" data-audit="work-when">{fmtTime(r.startedAt)} – {fmtTime(r.endedAt)} · {fmtDuration(r.durationS)}</p>
                      <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink">
                        <span data-audit="work-machine">Machine: {r.machine ?? 'not named yet'}</span>
                        {' · '}<span data-audit="work-origin">Origin: {r.device ? `${r.device} (Scout)` : 'a Scout no longer on the ranch'}</span>
                        {r.quantity && <> · <span className="font-semibold text-ink" data-audit="work-quantity">{r.quantity.bales.toLocaleString('en-US')} {r.quantity.bales === 1 ? 'bale' : 'bales'} {r.quantity.basis}</span></>}
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
          </section>
        ))}
        {res.ok && rows.length > 0 && <p className="mt-3 font-dm-sans text-[14px] text-secondary-ink">Newest first · this season · <Link href="/ranch/activity?source=machine" className="font-semibold text-brand underline underline-offset-2">every session, with maps →</Link></p>}
      </main>
    </>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { privateTitle } from '@/lib/private-title'
import { ranchNumbers } from '@/lib/ranch-summary'
import { listActivity, describeEvent, standingRows } from '@/lib/activity'
import ReviewedButton from '@/app/components/ReviewedButton'
import { dayKey, fmtTime, plural, todayKey } from '@/lib/jobs/format'

// ─── /ranch — the ranch hub, reinvented (Block 12, 12.7 / 12.8) ───────────────
//
// PK's ruling on 12.7: three things, not six. CATTLE (the herd), GROUND (where
// things are — places, and the devices that sit on them), THE RECORD (what
// happened — Activity, with machine work as the filter it already has). Hay
// leaves this list because Today's Hay tab is the surface; Work folds into the
// record; Devices fold under Ground. The routes all still answer.
//
// The usage evidence behind that was named thin — no per-page telemetry, 13
// manual entries on 4 days in six weeks — so this is a design call with a
// December revisit against Vercel's /ranch/* page views written into it.
//
// PK's ruling on 12.8: recent activity was two rows of a mixed list and "Show
// 26 more". What a person glancing at Ranch is actually asking is three
// things, in this order: did the hand do what I asked TODAY (per person, not
// per row); is there anything I have not looked at (the 6H cursor already
// knows); is there anything that needs me. "Today on the ranch" answers those
// and nothing else. The full list lives in Activity. Nothing on Ranch scrolls.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Ranch')

const fmtN = (n: number) => n.toLocaleString('en-US')

interface PersonToday { name: string; userId: string; lines: string[]; lastAt: string; count: number }

export default async function RanchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch')

  const [numbers, recent, member] = await Promise.all([
    ranchNumbers(supabase, user.id),
    listActivity(supabase, user.id, {}, null).catch(() => null),
    supabase.from('ranch_members').select('last_seen_at').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const today = todayKey()
  const standing = recent ? standingRows(recent.rows) : []
  const todays = standing.filter(r => dayKey(r.ts) === today)

  // One line per person who recorded something today, newest recorder first.
  const byPerson = new Map<string, PersonToday>()
  for (const r of todays) {
    const line = describeEvent(r, recent!.names)
    const p = byPerson.get(r.user_id) ?? { name: recent!.names.person(r.user_id), userId: r.user_id, lines: [], lastAt: r.ts, count: 0 }
    p.count += 1
    if (p.lines.length < 3) p.lines.push(line.replace(/^Removed: /, 'removed: '))
    if (r.ts > p.lastAt) p.lastAt = r.ts
    byPerson.set(r.user_id, p)
  }
  const people = [...byPerson.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt))

  // Anything landed since the person last checked — the 6H cursor. A late
  // sync is news the day it arrives, whatever day the work was.
  // No cursor yet (Reviewed never pressed) means the same thing it means on
  // Today's "Recorded since you checked": the last 24 hours. The first run of
  // the 12.8 check found this reading 0 for a hand's fresh entries because the
  // owner had no cursor — a null cursor is not "nothing is new".
  const lastSeen = (member.data as { last_seen_at?: string | null } | null)?.last_seen_at ?? new Date(Date.now() - 24 * 3_600_000).toISOString()
  const unseen = standing.filter(r => (r.ingested_at ?? r.ts) > lastSeen && r.user_id !== user.id).length

  // The last thing recorded at all, for a quiet day.
  const last = standing[0] ?? null

  const tiles: { href: string; label: string; number: string | null; audit: string }[] = [
    { href: '/ranch/cattle', label: 'Cattle', number: numbers.headInLots != null ? `${fmtN(numbers.headInLots)} head` : null, audit: 'cattle' },
    { href: '/ranch/places', label: 'Ground', number: numbers.places != null ? plural(numbers.places, 'place') + (numbers.devices != null ? ` · ${plural(numbers.devices, 'device')}` : '') : null, audit: 'ground' },
    { href: '/ranch/activity', label: 'The record', number: todays.length > 0 ? `${plural(todays.length, 'entry')} today` : null, audit: 'record' },
  ]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <h1 className="type-page-heading text-ink">Ranch</h1>

        {/* 12.8 — Today on the ranch */}
        <section className="mt-4" aria-labelledby="ranch-today">
          <h2 id="ranch-today" className={`${EYEBROW} !text-ink`}>Today on the ranch</h2>
          <Card className="mt-2 p-0" data-audit="ranch-today">
            {people.length === 0 ? (
              <p className="px-4 py-4 font-dm-sans text-[17px] text-ink" data-audit="ranch-quiet">
                Nothing recorded today{last ? ` · last entry ${dayKey(last.ts) === today ? '' : `${new Date(last.ts).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })} `}${fmtTime(last.ts)} by ${recent!.names.person(last.user_id)}` : ''}.
              </p>
            ) : (
              <ul className="divide-y divide-rule">
                {people.map(p => (
                  <li key={p.userId}>
                    <Link href={`/ranch/activity?actor=${p.userId}`} className="flex min-h-[56px] items-start justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="ranch-person" data-user={p.userId}>
                      <span className="min-w-0">
                        <span className="block font-dm-sans text-[17px] text-ink"><span className="font-semibold">{p.name}</span> · {p.lines.join(', ')}{p.count > p.lines.length ? ` · +${p.count - p.lines.length} more` : ''}</span>
                      </span>
                      <span className="shrink-0 font-dm-sans text-[15px] tabular-nums text-secondary-ink">last at {fmtTime(p.lastAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {unseen > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-3" data-audit="ranch-since">
                <p className="font-dm-sans text-[16px] text-ink">{plural(unseen, 'entry')} since you last checked.</p>
                {/* 6H: Reviewed is an action, never a page load. */}
                <ReviewedButton count={unseen} />
              </div>
            )}
          </Card>
        </section>

        {/* 12.7 — three things, each with its number */}
        <section className="mt-6" aria-label="Sections">
          <div className="grid grid-cols-1 gap-3" data-audit="ranch-tiles">
            {tiles.map(t => (
              <Link key={t.href} href={t.href} className="flex min-h-[72px] items-center justify-between gap-3 rounded-xl border border-rule bg-surface px-5 py-4 hover:bg-forest-green/[0.03]" data-audit="ranch-tile" data-tile={t.audit}>
                <span className="font-dm-sans text-[20px] font-semibold text-ink">{t.label}</span>
                <span className="text-right font-dm-sans text-[17px] tabular-nums text-ink">
                  {t.number && <span data-audit="tile-number">{t.number}</span>}
                  <span aria-hidden className="ml-2 text-secondary-ink">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  )
}

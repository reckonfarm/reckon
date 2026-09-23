import { createClient } from '@/lib/supabase-server'
import { fmtDay, fmtTime, todayKey, dayKey } from '@/lib/jobs/format'
import { lotLabel } from '@/lib/herd'
import { getRanchLots } from '@/lib/herd-lots'
import RepeatLastCard, { type LastFeeding } from './RepeatLastCard'
import { effective } from '@/lib/ledger-effective'

// The feedings the ranch repeats, resolved to words (bunch label, place name,
// when) and handed to the client card. RLS-scoped read on the user-scoped
// client; nothing → renders nothing (no empty state pretending to be a
// shortcut).
//
// Block 33 (ruling 3): every regularly fed bunch, not only the last feeding.
// A bunch fed at least twice in the last fourteen days is being fed regularly,
// and its latest feeding is offered; the last feeding of all is offered
// whatever it was, so the card never loses the one thing it always did. Up to
// four rows, newest first — more than that is a list, not a shortcut.

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const REGULAR_DAYS = 14
const REGULAR_MIN = 2
const ROWS = 4
const regularFloor = () => new Date(Date.now() - REGULAR_DAYS * 86_400_000).toISOString()

function whenLabel(iso: string): string {
  const day = dayKey(iso)
  const today = todayKey()
  const yesterday = dayKey(Date.now() - 86_400_000)
  const t = fmtTime(iso)
  if (day === today) return `today ${t}`
  if (day === yesterday) return `yesterday ${t}`
  return `${fmtDay(iso)} ${t}`
}

interface Row { id: string; ts: string; payload: Record<string, unknown> }

export default async function RepeatLastFeeding() {
  const supabase = await createClient()
  const floor = regularFloor()
  const { data } = await effective(supabase   // Block 5B: feedings that STAND
    .from('events')
    .select('id, ts, payload')
    .eq('type', 'hay_fed')
    .eq('payload->>source', 'manual'))
    .gte('ts', floor)
    .order('ts', { ascending: false })
    .limit(300)
  let rows = ((data ?? []) as Row[]).filter(r => num(r.payload.bales) != null)
  if (rows.length === 0) {
    // Nothing in the window: the last feeding of all, however old (the card as it always was).
    const { data: last } = await effective(supabase.from('events').select('id, ts, payload').eq('type', 'hay_fed').eq('payload->>source', 'manual')).order('ts', { ascending: false }).limit(1)
    rows = ((last ?? []) as Row[]).filter(r => num(r.payload.bales) != null)
  }
  if (rows.length === 0) return null

  // The latest feeding per bunch, and how many times each bunch was fed in the window.
  const perLot = new Map<string, { latest: Row; times: number }>()
  for (const r of rows) {
    const lot = str(r.payload.herd_lot_id)
    if (!lot) continue
    const e = perLot.get(lot)
    if (e) e.times += 1; else perLot.set(lot, { latest: r, times: 1 })
  }
  const chosen = new Map<string, Row>()
  chosen.set(rows[0].id, rows[0])
  for (const { latest, times } of perLot.values()) if (times >= REGULAR_MIN) chosen.set(latest.id, latest)
  const list = [...chosen.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, ROWS)

  const placeIds = [...new Set(list.map(r => str(r.payload.place_id)).filter((v): v is string => !!v))]
  const [placesRes, lots] = await Promise.all([
    placeIds.length ? supabase.from('places').select('id, name').in('id', placeIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    getRanchLots(supabase),   // the RANCH's lots (Block 4A)
  ])
  const placeNames = new Map(((placesRes.data ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name]))

  const feedings: LastFeeding[] = list.map(r => {
    const placeId = str(r.payload.place_id), lotId = str(r.payload.herd_lot_id)
    const lot = lotId ? lots.find(l => l.id === lotId) : undefined
    const placeName = placeId ? placeNames.get(placeId) ?? null : null
    return { id: r.id, bales: num(r.payload.bales)!, lotId: lot ? lotId : null, lotLabel: lot ? lotLabel(lot) : null, placeId: placeName ? placeId : null, placeName, whenLabel: whenLabel(r.ts) }
  })
  return <RepeatLastCard feedings={feedings} />
}

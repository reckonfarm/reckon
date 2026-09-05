import { createClient } from '@/lib/supabase-server'
import { fmtDay, fmtTime, todayKey, dayKey } from '@/lib/jobs/format'
import { lotLabel, type Lot } from '@/lib/herd'
import RepeatLastCard, { type LastFeeding } from './RepeatLastCard'

// The most recent feeding the ranch logged by hand, resolved to words (lot
// label, place name, when), handed to the client card. RLS-scoped read on
// the user-scoped client; nothing → renders nothing (no empty state
// pretending to be a shortcut).

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function whenLabel(iso: string): string {
  const day = dayKey(iso)
  const today = todayKey()
  const yesterday = dayKey(Date.now() - 86_400_000)
  const t = fmtTime(iso)
  if (day === today) return `today ${t}`
  if (day === yesterday) return `yesterday ${t}`
  return `${fmtDay(iso)} ${t}`
}

export default async function RepeatLastFeeding() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('events')
    .select('id, ts, payload')
    .eq('type', 'hay_fed')
    .eq('payload->>source', 'manual')
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const p = (data.payload ?? {}) as Record<string, unknown>
  const bales = num(p.bales)
  if (bales == null) return null

  const placeId = str(p.place_id)
  const lotId = str(p.herd_lot_id)
  let placeName: string | null = null
  let lotName: string | null = null
  const [placeRes, profileRes] = await Promise.all([
    placeId ? supabase.from('places').select('name').eq('id', placeId).maybeSingle() : Promise.resolve({ data: null }),
    lotId ? supabase.from('operation_profiles').select('herd').maybeSingle() : Promise.resolve({ data: null }),
  ])
  placeName = (placeRes.data as { name?: string } | null)?.name ?? null
  const lots = (profileRes.data as { herd?: { lots?: Lot[] } } | null)?.herd?.lots
  const lot = Array.isArray(lots) ? lots.find(l => l.id === lotId) : undefined
  lotName = lot ? lotLabel(lot) : null

  const last: LastFeeding = { bales, lotId: lot ? lotId : null, lotLabel: lotName, placeId: placeName ? placeId : null, placeName, whenLabel: whenLabel(data.ts as string) }
  return <RepeatLastCard last={last} />
}

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Job annotations — user layer over the derived jobs table ──────────────────
// Separate table (037), keyed by the stable job id, NO FK: re-derivation
// rewrites jobs wholesale and must never touch user intent. Fetched as a
// second query and merged in app code — PostgREST can't embed without a FK,
// and that limitation is the feature.

export interface JobAnnotation {
  job_id: string
  name: string | null
  machine: string | null
  dismissed_at: string | null
  // Ground truth (039), operator-reported. Null = not reported, never zero.
  actual_bale_count: number | null
  actual_acres: number | null
}

export async function fetchAnnotations(
  supabase: SupabaseClient,
  jobIds: string[],
): Promise<Map<string, JobAnnotation>> {
  if (jobIds.length === 0) return new Map()
  const { data } = await supabase
    .from('job_annotations')
    .select('job_id, name, machine, dismissed_at, actual_bale_count, actual_acres')
    .in('job_id', jobIds)
  return new Map((data ?? []).map(a => [a.job_id, a as JobAnnotation]))
}

// Per-field completion (040): fields_cut jsonb on the same annotation row —
// { "<field index>": "cut" | "dismissed" }. The operator's word that a field
// is finished, proposed by the system and confirmed with one tap; it survives
// re-derivation exactly like every other annotation (field indexes are
// deterministic: time-ordered clusters of the same track). Fetched separately
// and TOLERANTLY — before 040 is applied the column doesn't exist, and the
// completion feature simply stays invisible rather than breaking the page.
export type FieldCutStatus = 'cut' | 'dismissed'

export async function fetchFieldsCut(
  supabase: SupabaseClient,
  jobId: string,
): Promise<Record<string, FieldCutStatus>> {
  try {
    const { data, error } = await supabase
      .from('job_annotations')
      .select('fields_cut')
      .eq('job_id', jobId)
      .maybeSingle()
    if (error || data?.fields_cut == null || typeof data.fields_cut !== 'object') return {}
    const out: Record<string, FieldCutStatus> = {}
    for (const [k, v] of Object.entries(data.fields_cut as Record<string, unknown>)) {
      if (v === 'cut' || v === 'dismissed') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

// Suggested names — tappable chips so the common case never needs the
// keyboard. A stopgap until field boundaries let the place name the work.
export const NAME_SUGGESTIONS = ['Baling', 'Cutting', 'Raking', 'Hauling bales', 'Moving equipment'] as const

// Machine kinds — the values the detection layer reads (queries filter on
// them; a detector's results are "confirmed" when the job's machine matches
// the detector's machine). Text by convention, not an enum: UI offers these,
// the column accepts anything, and an unrecognized value simply matches no
// detector — visible as machine-unknown, never a crash.
export const MACHINE_SUGGESTIONS = [
  { value: 'baler', label: 'Baler' },
  { value: 'swather', label: 'Swather' },
  { value: 'rake', label: 'Rake' },
  { value: 'other', label: 'Something else' },
] as const

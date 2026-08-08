import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { runDerivation } from '@/lib/jobs/run-derivation'
import { runDetections } from '@/lib/detections/run-detection'

// ─── /api/cron/derive-jobs — live jobs ─────────────────────────────────────────
// Fires every 3 minutes (vercel.json) so a session in progress grows on the
// map while the machine is still working: the courier uploads a batch, the
// next tick re-derives, the open job page shows the new track. Start time
// stable, end time advancing — that's the designed behavior of wholesale
// delete-and-rewrite plus stable (hardware_id, seq_start) job ids.
//
// Auth mirrors the other crons: Vercel sends `Authorization: Bearer CRON_SECRET`.
// Manual trigger hits www.dryline.farm directly (apex 307 drops the bearer):
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.dryline.farm/api/cron/derive-jobs
//
// A full run is light (one device ≈ 1.3k events, a few queries) — well inside
// default function limits. Concurrent runs (cron + laptop CLI) can collide on
// the delete/insert pair; the loser errors loudly and the next tick heals it.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = createServiceClient()
    const { devices, deriverVersion } = await runDerivation(db, { write: true })

    // Detection follows derivation in the same tick, but fails SOFT: a
    // detection error (e.g. 038 not yet applied) must never take down job
    // derivation — the layers are independently re-runnable on purpose.
    let detection: Record<string, unknown>
    try {
      const { devices: detDevices, detectorVersions } = await runDetections(db, { write: true })
      detection = {
        ok: true,
        detector_versions: detectorVersions,
        devices: detDevices.map(d => ({
          hardware_id: d.hardwareId,
          skipped: d.skipped,
          runs: d.wrote?.runs ?? 0,
          detections: d.wrote?.detections ?? 0,
        })),
      }
    } catch (e) {
      detection = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    return Response.json({
      ok: true,
      deriver_version: deriverVersion,
      devices: devices.map(d => ({
        hardware_id: d.hardwareId,
        skipped: d.skipped,
        jobs: d.wrote,
        events_in_scope: d.result ? d.rawRows - d.excluded - d.unparseable : 0,
      })),
      detection,
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

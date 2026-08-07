'use client'

import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { forestGreen } from '@/lib/brand-colors'
import type { JobMapProps } from './JobMapLoader'

// ─── The job map — draw exactly what the ledger holds, nothing more ────────────
// Track points in seq order; SOLID segments only between seq-adjacent recorded
// impacts (link==='solid', decided by the deriver), DASHED connectors across
// every discontinuity — evicted events, silence, or lost fix. A dashed hop
// reads as "the machine got from A to B; we did not watch it happen."
//
// Impact size = color + radius (sequential rust ramp, light→dark; dataviz
// method: magnitude gets ONE hue). Color alone never carries it — bigger hits
// get bigger markers, and every marker has a popup with the numbers.

const MG_BUCKETS = [
  { min: 6000, color: '#5C2013', radius: 7, label: '≥ 6 g' },
  { min: 4000, color: '#8B3A2B', radius: 6, label: '4–6 g' },
  { min: 3000, color: '#B4664A', radius: 5, label: '3–4 g' },
  { min: 2500, color: '#D28E6E', radius: 4, label: '2.5–3 g' },
  { min: 0,    color: '#EAB8A2', radius: 3, label: '< 2.5 g' },
] as const

function bucketFor(mg: number | null) {
  if (mg == null) return MG_BUCKETS[MG_BUCKETS.length - 1]
  return MG_BUCKETS.find(b => mg >= b.min) ?? MG_BUCKETS[MG_BUCKETS.length - 1]
}

const GAP_GRAY = '#6B7280'

const fmtTime = (t: number) =>
  new Date(t * 1000).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', second: '2-digit',
  })

function Legend() {
  return (
    <div className="leaflet-bottom leaflet-right" style={{ marginBottom: 24, marginRight: 12 }}>
      <div className="leaflet-control rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-sm">
        <p className="font-dm-sans text-[11px] font-semibold text-forest-green">Impact strength</p>
        {MG_BUCKETS.map(b => (
          <div key={b.label} className="mt-1 flex items-center gap-2">
            <span
              style={{
                width: b.radius * 2, height: b.radius * 2, background: b.color,
                borderRadius: '50%', border: '1.5px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
              }}
            />
            <span className="font-dm-sans text-[11px] text-forest-green/70">{b.label}</span>
          </div>
        ))}
        <div className="mt-2 border-t border-gray-100 pt-1.5">
          <div className="flex items-center gap-2">
            <span style={{ width: 18, borderTop: `3px solid ${forestGreen}` }} />
            <span className="font-dm-sans text-[11px] text-forest-green/70">recorded path</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span style={{ width: 18, borderTop: `2px dashed ${GAP_GRAY}` }} />
            <span className="font-dm-sans text-[11px] text-forest-green/70">gap in data</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function JobMapClient({ track, bbox }: JobMapProps) {
  // Split the track into solid runs and dashed gap connectors.
  const solidRuns: [number, number][][] = []
  const gapHops: [number, number][][] = []
  let run: [number, number][] = []
  track.forEach((p, i) => {
    if (i > 0 && p.link === 'gap') {
      if (run.length >= 2) solidRuns.push(run)
      gapHops.push([[track[i - 1].lat, track[i - 1].lng], [p.lat, p.lng]])
      run = []
    }
    run.push([p.lat, p.lng])
  })
  if (run.length >= 2) solidRuns.push(run)

  const bounds: [[number, number], [number, number]] = bbox
    ? [[bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.maxLng]]
    : [[track[0].lat, track[0].lng], [track[track.length - 1].lat, track[track.length - 1].lng]]

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        preferCanvas
        style={{ height: 420, width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {gapHops.map((hop, i) => (
          <Polyline
            key={`gap-${i}`}
            positions={hop}
            pathOptions={{ color: GAP_GRAY, weight: 2, opacity: 0.6, dashArray: '2 8' }}
          />
        ))}
        {solidRuns.map((r, i) => (
          <Polyline
            key={`run-${i}`}
            positions={r}
            pathOptions={{ color: forestGreen, weight: 3, opacity: 0.8 }}
          />
        ))}

        {track.map(p => {
          const b = bucketFor(p.mg)
          return (
            <CircleMarker
              key={p.seq}
              center={[p.lat, p.lng]}
              radius={b.radius}
              pathOptions={{ color: 'white', weight: 1.5, fillColor: b.color, fillOpacity: 0.85 }}
            >
              <Popup>
                <div className="font-dm-sans text-xs">
                  <p className="font-semibold">{fmtTime(p.t)} MT</p>
                  <p className="mt-0.5">
                    {p.mg != null ? `${(p.mg / 1000).toFixed(1)} g impact` : 'impact'}
                    {p.w != null && ` · width ${p.w}`}
                  </p>
                  <p className="mt-0.5 text-gray-500">seq {p.seq}</p>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        <Legend />
      </MapContainer>
    </div>
  )
}

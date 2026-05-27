'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import Link from 'next/link'
import 'leaflet/dist/leaflet.css'

interface MapListing {
  id: string
  hay_type: string | null
  listing_type: string
  price_per_ton: number | null
  tonnage: number | null
  lat: number
  lon: number
  drought_tier: number | null
  county_name: string
  state: string
}

const DROUGHT_COLORS: Record<number, string> = {
  4: '#7B2D00',
  3: '#C2410C',
  2: '#D97706',
  1: '#92400E',
  0: '#1B4332',
}

function pinColor(tier: number | null): string {
  if (tier === null) return '#1B4332'
  return DROUGHT_COLORS[tier] ?? '#1B4332'
}

function ResetButton() {
  const map = useMap()
  return (
    <div className="leaflet-bottom leaflet-left" style={{ marginBottom: 24, marginLeft: 12 }}>
      <div className="leaflet-control">
        <button
          onClick={() => map.setView([39.5, -98.5], 4)}
          className="rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-dm-sans text-forest-green shadow-sm hover:bg-gray-50"
        >
          Reset view
        </button>
      </div>
    </div>
  )
}

export default function HayMapClient({ listings }: { listings: MapListing[] }) {
  useEffect(() => {
    // Fix leaflet default icon paths in Next.js
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).L?.Icon?.Default?.prototype?._getIconUrl
  }, [])

  return (
    <div style={{ height: 'calc(100vh - 64px)', width: '100%', position: 'relative' }}>
      <MapContainer
        center={[39.5, -98.5]}
        zoom={4}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {listings.map(l => (
          <CircleMarker
            key={l.id}
            center={[l.lat, l.lon]}
            radius={8}
            pathOptions={{
              fillColor: pinColor(l.drought_tier),
              fillOpacity: 0.85,
              color: '#fff',
              weight: 1.5,
            }}
          >
            <Popup>
              <div style={{ fontFamily: 'var(--font-dm-sans)', minWidth: 160 }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>
                  {l.hay_type ?? 'Hay'} — {l.county_name}, {l.state}
                </p>
                {l.tonnage && <p style={{ fontSize: 12, color: '#555' }}>{l.tonnage} tons</p>}
                {l.price_per_ton && <p style={{ fontSize: 12, color: '#555' }}>${l.price_per_ton}/ton</p>}
                <Link
                  href={`/hay/${l.id}`}
                  style={{ fontSize: 12, color: '#1B4332', textDecoration: 'underline', display: 'block', marginTop: 6 }}
                >
                  View listing →
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        ))}
        <ResetButton />
      </MapContainer>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 32, right: 12, zIndex: 1000,
        background: 'white', border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 8, padding: '8px 12px', fontSize: 11,
        fontFamily: 'var(--font-dm-sans)',
      }}>
        {[
          { tier: 4, label: 'D4 Exceptional' },
          { tier: 3, label: 'D3 Extreme' },
          { tier: 2, label: 'D2 Severe' },
          { tier: 1, label: 'D1 Moderate' },
          { tier: 0, label: 'D0 Abnormally dry' },
          { tier: -1, label: 'No drought' },
        ].map(({ tier, label }) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: pinColor(tier === -1 ? null : tier),
              border: '1.5px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
            }} />
            <span style={{ color: '#444' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

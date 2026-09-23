'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { pointInPolygon, projectXY, type LatLng } from '@/lib/places/geo'
import { CAPTURE_EVENT } from '@/lib/places/capture-event'
import type { RanchMap } from '@/lib/ranch-map'

// ─── Block 38: Record loses the map (reverses Block 20, ruling 1) ────────────
// Two maps is one too many, and the map was in the way of the screen opened
// fifty times a day. Record opens straight to the actions: one row of
// icon-plus-word buttons, the three rarer workings as words under it, the
// ways to mark ground behind Place. Nothing above them, nothing to scroll.
//
// Place is picked inside the action that needs it — the form's Where,
// defaulting from the bunch (Block 33) or, with a fix, from the ground you
// stand on. Block 20's ruling 3 stands exactly: no fix, no tiles, no signal —
// every button still opens its form and the form still saves. The ranch is
// still read from /api/ranch/map and the last good answer kept on the phone:
// that copy is what names the places when there is no signal.

export type PickAction = 'hay_fed' | 'cattle_moved' | 'cattle_counted' | 'rain' | 'cattle_worked' | 'place'

const MAP_KEY = 'dryline_ranch_map_v1'
const readCached = (): RanchMap | null => { try { const raw = localStorage.getItem(MAP_KEY); return raw ? JSON.parse(raw) as RanchMap : null } catch { return null } }
const writeCached = (m: RanchMap) => { try { localStorage.setItem(MAP_KEY, JSON.stringify(m)) } catch { /* private mode, or full — the map is a convenience */ } }

// The word is what is painted; the full verb is the accessible name (the word is
// its first word, so a reader and a suite both find it).
const ACTIONS: { key: PickAction; word: string; name: string; icon: React.ReactNode }[] = [
  { key: 'hay_fed', word: 'Feed', name: 'Feed hay', icon: <path d="M3 17h18M5 17V9l7-4 7 4v8M9 17v-5h6v5" /> },
  { key: 'cattle_moved', word: 'Move', name: 'Move cattle', icon: <path d="M4 12h13M13 6l6 6-6 6" /> },
  { key: 'cattle_counted', word: 'Count', name: 'Count cattle', icon: <path d="M5 7h2M5 12h2M5 17h2M10 7h9M10 12h9M10 17h9" /> },
  { key: 'rain', word: 'Rain', name: 'Record rain', icon: <path d="M7 15a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1-.5 7H7zM8 18l-1 3M12 18l-1 3M16 18l-1 3" /> },
  { key: 'cattle_worked', word: 'Work', name: 'Record cattle work', icon: <path d="M14 4l6 6-9 9H5v-6l9-9zM12 6l6 6" /> },
  { key: 'place', word: 'Place', name: 'Mark a place', icon: <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" /> },
]

export type RareAction = 'preg_check' | 'hay_inventory' | 'bales_stacked'

export default function RecordPicker({ onPick, onRare, onClose }: { onPick: (action: Exclude<PickAction, 'place'>, placeId: string | null) => void; onRare: (action: RareAction, placeId: string | null) => void; onClose: () => void }) {
  const [map, setMap] = useState<RanchMap | null>(() => (typeof window === 'undefined' ? null : readCached()))
  const [fix, setFix] = useState<{ p: LatLng; accuracyM: number } | null>(null)
  const [placeMenu, setPlaceMenu] = useState(false)

  // The ranch, fresh when there is signal; the last good answer otherwise.
  useEffect(() => {
    let alive = true
    fetch('/api/ranch/map').then(r => (r.ok ? r.json() : null)).then((j: { map?: RanchMap | null } | null) => {
      if (!alive || !j?.map) return
      setMap(j.map); writeCached(j.map)
    }).catch(() => { /* no signal: the cached map, or none */ })
    return () => { alive = false }
  }, [])

  // One foreground fix, if the phone will give one quickly. Never waited on.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    let alive = true
    navigator.geolocation.getCurrentPosition(
      pos => { if (alive) setFix({ p: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracyM: pos.coords.accuracy }) },
      () => { /* no fix: the form asks, or the bunch answers */ },
      { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 },
    )
    return () => { alive = false }
  }, [])

  // The place under the fix: the first drawn place whose ring holds it.
  const underFix = useMemo(() => {
    if (!fix || !map) return null
    for (const p of map.places) {
      if (!p.ring) continue
      const [pt, ...ring] = projectXY([fix.p, ...p.ring], fix.p.lat)
      if (pointInPolygon(pt, ring)) return p.id
    }
    return null
  }, [fix, map])

  const act = useCallback((a: PickAction) => {
    if (a === 'place') { setPlaceMenu(m => !m); return }
    onPick(a, underFix)
  }, [onPick, underFix])

  return (
    <div className="mt-4" data-audit="record-picker" data-map={map ? 'kept' : 'none'} data-fix={fix ? 'yes' : 'no'} data-under-fix={underFix ?? ''}>
      {/* The row, first and with nothing above it. Icon plus a short word, never the icon alone. */}
      <div className="grid grid-cols-6 gap-1" role="group" aria-label="Record" data-audit="record-actions">
        {ACTIONS.map(a => (
          <button key={a.key} type="button" onClick={() => act(a.key)} aria-label={a.name} aria-pressed={a.key === 'place' ? placeMenu : undefined}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border px-1 font-dm-sans text-[14px] font-semibold ${a.key === 'place' && placeMenu ? 'border-brand bg-brand text-cream' : 'border-forest-green/15 bg-white text-forest-green'}`}
            data-audit={`tile-${a.key}`} data-action={a.key}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{a.icon}</svg>
            <span>{a.word}</span>
          </button>
        ))}
      </div>

      {/* The three the row does not carry, one tap each, as words. */}
      <div className="mt-2 flex flex-wrap gap-x-4" data-audit="record-rare">
        {([['preg_check', 'Preg check'], ['hay_inventory', 'Count hay'], ['bales_stacked', 'Add bales to a stack']] as const).map(([k, w]) => (
          <button key={k} type="button" onClick={() => onRare(k, underFix)} className="min-h-[48px] font-dm-sans text-[16px] font-semibold text-forest-green underline underline-offset-2" data-audit={k === 'preg_check' ? 'tile-preg-check' : `tile-${k}`}>{w}</button>
        ))}
      </div>

      {/* Place: mark ground, the same three ways as before. */}
      {placeMenu && (
        <div className="mt-2 grid grid-cols-1 gap-2" data-audit="record-place-menu">
          {([
            ['drop', 'Drop a point where you stand'],
            ['ride', 'Ride the perimeter'],
            ['draw', 'Draw a place on the map'],
          ] as const).map(([mode, label]) => (
            <Link key={mode} href={mode === 'draw' ? '/ranch/places#capture' : `/ranch/places#capture-${mode}`}
              onClick={() => { onClose(); if (mode !== 'draw' && window.location.pathname === '/ranch/places') window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: mode })) }}
              className="flex min-h-[56px] items-center rounded-lg border border-forest-green/15 bg-white px-4 font-dm-sans text-[17px] font-semibold text-forest-green" data-audit={`ground-${mode}`}>
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

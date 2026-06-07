'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'
import SiteFooter from '@/app/components/SiteFooter'
import MarketplaceDisclaimer from '@/app/components/MarketplaceDisclaimer'
import type { HayListing, HayCounty } from '@/lib/types/hay'
import { deliveredCost } from '@/lib/freight'
import { trackEvent } from '@/lib/analytics'

type SortKey = 'delivered' | 'newest' | 'price'

const DROUGHT_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'D1', cls: 'bg-yellow-100 text-yellow-800 ring-yellow-200' },
  2: { label: 'D2', cls: 'bg-orange-100 text-orange-800 ring-orange-200' },
  3: { label: 'D3', cls: 'bg-red-100 text-red-700 ring-red-200' },
  4: { label: 'D4', cls: 'bg-red-200 text-red-900 ring-red-300' },
}

const BALE_TYPE_LABELS: Record<string, string> = {
  small_square_2string: 'Small Square (2-string)',
  small_square_3string: 'Small Square (3-string)',
  large_square_3x3:     'Large Square (3x3)',
  large_square_3x4:     'Large Square (3x4)',
  large_square_4x4:     'Large Square (4x4)',
  round_4x4:            'Round (4x4)',
  round_5x6:            'Round (5x6)',
  // Legacy values (pre-017) — displayed cleanly until the migration remaps them.
  large_round:      'Round (5x6)',
  small_round:      'Round (4x4)',
  small_square:     'Small Square (2-string)',
  '3string_square': 'Small Square (3-string)',
  '4string_square': 'Small Square (3-string)',
}

const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }

const HAY_TYPES = ['Alfalfa', 'Grass', 'Mixed', 'Small Grain', 'Alfalfa-Grass Mix', 'Prairie']

// Draft persistence — survives backgrounding / navigation so an interrupted
// seller on poor signal doesn't lose their work. Text fields only (File objects
// can't be serialized; photos are re-picked if a draft is resumed).
const DRAFT_KEY = 'dryline_hay_draft_v1'

// Freshness thresholds (days). Derived from expires_at: a listing starts with
// 30 days left and "Confirm still available" pushes it back to 30. So
// daysSinceActivity = 30 - daysLeft.
const STALE_NUDGE_DAYS = 14 // seller sees a "still available?" nudge past this
const STALE_BUYER_DAYS  = 21 // buyers see a muted "may be stale" past this
const LISTING_TTL_DAYS  = 30

const INPUT_CLS =
  'w-full rounded-xl border border-forest-green/20 bg-white px-4 py-2.5 text-sm font-dm-sans text-forest-green placeholder-forest-green/40 focus:outline-none focus:ring-2 focus:ring-forest-green/30'

const SELECT_CLS =
  'w-full rounded-xl border border-forest-green/20 bg-white px-4 py-2.5 text-sm font-dm-sans text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30'

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}


export default function HayPage() {
  const router = useRouter()

  const [authed, setAuthed]         = useState<boolean | null>(null)
  const [listings, setListings]     = useState<HayListing[]>([])
  const [listingsLoading, setListingsLoading] = useState(true)
  const searchParams    = useSearchParams()
  const [tab, setTab]           = useState<'sell' | 'want'>('sell')
  const [showForm, setShowForm] = useState(false)
  const [filterState,   setFilterState]   = useState(searchParams.get('state')   ?? '')
  const [filterVariety, setFilterVariety] = useState(searchParams.get('variety') ?? '')
  const [filterType,    setFilterType]    = useState(searchParams.get('type')    ?? '')

  // Deliver-to: explicit county override (URL ?deliverTo=fips or picker),
  // falling back to the buyer's most-recent watchlist county.
  const [watchlistCounty, setWatchlistCounty] = useState<HayCounty | null>(null)
  const [deliverCounty,   setDeliverCounty]   = useState<HayCounty | null>(null)
  const deliverFipsRef = useRef<string | null>(null)
  const [editingDeliver,  setEditingDeliver]  = useState(false)
  const [deliverQuery,    setDeliverQuery]    = useState('')
  const [deliverResults,  setDeliverResults]  = useState<HayCounty[]>([])
  const [deliverDropOpen, setDeliverDropOpen] = useState(false)
  const deliverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sortChosen, setSortChosen] = useState<SortKey | null>(null)

  // ── Hay Radar: save this search ───────────────────────────────────────────
  const [showSave,     setShowSave]     = useState(false)
  const [saveLabel,    setSaveLabel]    = useState('')
  const [saveMaxPrice, setSaveMaxPrice] = useState('')
  const [saveMaxDist,  setSaveMaxDist]  = useState('')
  const [saveType,     setSaveType]     = useState<'' | 'sell' | 'donate'>('')
  const [saving,       setSaving]       = useState(false)
  const [saveDone,     setSaveDone]     = useState(false)
  const [saveError,    setSaveError]    = useState('')

  const pushFilters = useCallback((st: string, va: string, ty: string) => {
    const p = new URLSearchParams()
    if (st) p.set('state', st)
    if (va) p.set('variety', va)
    if (ty) p.set('type', ty)
    if (deliverFipsRef.current) p.set('deliverTo', deliverFipsRef.current)
    router.replace(`/hay${p.toString() ? '?' + p.toString() : ''}`, { scroll: false })
  }, [router])
  const [removing, setRemoving] = useState<Set<string>>(new Set())

  // ── Form: Group 1 — core ──────────────────────────────────────────────────
  const [selectedCounty, setSelectedCounty] = useState<HayCounty | null>(null)
  const [countyQuery, setCountyQuery]       = useState('')
  const [countyResults, setCountyResults]   = useState<HayCounty[]>([])
  const [countyDropOpen, setCountyDropOpen] = useState(false)
  const [listingType, setListingType]       = useState<'sell' | 'want' | 'donate'>('sell')
  const [hayType, setHayType]               = useState('')

  // ── Form: Group 2 — quality details ──────────────────────────────────────
  const [baleType, setBaleType]         = useState('')
  const [cuttingNumber, setCuttingNumber] = useState('')
  const [baleWeightLbs, setBaleWeightLbs] = useState('')
  const [storageMethod, setStorageMethod] = useState('')

  // ── Form: Group 3 — quantity + price ─────────────────────────────────────
  const [tonnage, setTonnage]         = useState('')
  const [pricePerTon, setPricePerTon] = useState('')

  // ── Form: Group 4 — hay test (collapsible) ────────────────────────────────
  const [showHayTest, setShowHayTest]     = useState(false)
  const [hayTestProtein, setHayTestProtein] = useState('')
  const [hayTestTdn, setHayTestTdn]         = useState('')
  const [hayTestMoisture, setHayTestMoisture] = useState('')
  const [hayTestRfv, setHayTestRfv]         = useState('')

  // ── Form: Group 5 — contact + logistics ──────────────────────────────────
  const [haulRadius, setHaulRadius]   = useState('')
  const [contact, setContact]         = useState('')
  const [description, setDescription] = useState('')
  const [reliefFlag, setReliefFlag]   = useState(false)

  // ── Form: Group 6 — photos ────────────────────────────────────────────────
  const [photoFiles, setPhotoFiles]         = useState<File[]>([])
  const [photoUrls, setPhotoUrls]           = useState<string[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  // Resilient create→upload→PATCH: once the row exists, remember its id so a
  // retry after a dropped connection resumes instead of creating a duplicate.
  const [createdListingId, setCreatedListingId] = useState<number | null>(null)
  const [uploadedUrls, setUploadedUrls]         = useState<string[]>([])
  const [photoError, setPhotoError]             = useState('')

  // Edit mode — when set, the form edits an existing listing (PATCH) instead of
  // creating one. Preserves id / created_at / URL.
  const [editingId, setEditingId] = useState<number | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState('')

  // Per-listing busy flags for the one-tap "still available / mark sold" actions.
  const [freshBusy, setFreshBusy] = useState<Set<string>>(new Set())
  const [draftRestored, setDraftRestored] = useState(false)

  const countyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchListings() {
    const data = await fetch('/api/hay').then(r => r.ok ? r.json() : [])
    setListings(Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    const supabase = createClient()

    fetchListings().finally(() => setListingsLoading(false))

    // Fetch the buyer's watchlist county for an already-known signed-in status.
    // Calls no auth method, so it's safe from inside onAuthStateChange (re-calling
    // getSession/getUser there re-enters the GoTrueClient lock → DEADLOCK — the bug).
    async function loadWatchlistCounty() {
      try {
        const wl = await fetch('/api/watchlist').then(r => r.ok ? r.json() : [])
        const first = Array.isArray(wl) ? wl[0] : null
        if (first?.county?.lat != null && first?.county?.lon != null) {
          setWatchlistCounty({
            id:    first.countyId ?? 0,
            fips:  first.county.fips,
            name:  first.county.name,
            state: first.county.state,
            lat:   first.county.lat,
            lon:   first.county.lon,
          })
        }
      } catch { /* non-fatal */ }
    }

    // Initial read: one-shot getSession (local, no network getUser). (f7380dc pattern.)
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setAuthed(!!session)
        if (session) loadWatchlistCounty()
      })
      .catch(() => setAuthed(false))

    // Auth changes: use the PASSED session — never re-call getSession here.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setAuthed(!!session)
      if (session) loadWatchlistCounty()
      fetchListings()
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (countyTimer.current) clearTimeout(countyTimer.current)
    if (!countyQuery.trim()) { setCountyResults([]); setCountyDropOpen(false); return }
    countyTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/counties?search=${encodeURIComponent(countyQuery.trim())}`)
      if (res.ok) {
        const data: HayCounty[] = await res.json()
        setCountyResults(data)
        setCountyDropOpen(data.length > 0)
      }
    }, 300)
    return () => { if (countyTimer.current) clearTimeout(countyTimer.current) }
  }, [countyQuery])

  // Resolve ?deliverTo=fips into the explicit deliver county (source of truth,
  // survives refresh and is shareable). Cleared when the param is absent.
  const deliverToParam = searchParams.get('deliverTo')
  useEffect(() => {
    deliverFipsRef.current = deliverToParam
    if (!deliverToParam) { setDeliverCounty(null); return }
    let cancelled = false
    fetch(`/api/counties?search=${encodeURIComponent(deliverToParam)}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: HayCounty[]) => {
        if (cancelled) return
        const exact = Array.isArray(rows) ? rows.find(c => c.fips === deliverToParam) : null
        if (exact && exact.lat != null && exact.lon != null) setDeliverCounty(exact)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [deliverToParam])

  // Debounced county search for the "Deliver to" picker
  useEffect(() => {
    if (deliverTimer.current) clearTimeout(deliverTimer.current)
    if (!deliverQuery.trim()) { setDeliverResults([]); setDeliverDropOpen(false); return }
    deliverTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/counties?search=${encodeURIComponent(deliverQuery.trim())}`)
      if (res.ok) {
        const data: HayCounty[] = await res.json()
        setDeliverResults(data)
        setDeliverDropOpen(data.length > 0)
      }
    }, 300)
    return () => { if (deliverTimer.current) clearTimeout(deliverTimer.current) }
  }, [deliverQuery])

  // ── Draft persistence ──────────────────────────────────────────────────────
  // Restore an in-progress draft once on mount. Photos (File objects) can't be
  // serialized, so a resumed draft re-opens the form with all text intact and
  // asks the seller to re-pick photos if they had any.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        setListingType(d.listingType ?? 'sell')
        setHayType(d.hayType ?? '')
        setBaleType(d.baleType ?? '')
        setCuttingNumber(d.cuttingNumber ?? '')
        setBaleWeightLbs(d.baleWeightLbs ?? '')
        setStorageMethod(d.storageMethod ?? '')
        setTonnage(d.tonnage ?? '')
        setPricePerTon(d.pricePerTon ?? '')
        setShowHayTest(!!d.showHayTest)
        setHayTestProtein(d.hayTestProtein ?? '')
        setHayTestTdn(d.hayTestTdn ?? '')
        setHayTestMoisture(d.hayTestMoisture ?? '')
        setHayTestRfv(d.hayTestRfv ?? '')
        setHaulRadius(d.haulRadius ?? '')
        setContact(d.contact ?? '')
        setDescription(d.description ?? '')
        setReliefFlag(!!d.reliefFlag)
        if (d.selectedCounty) setSelectedCounty(d.selectedCounty)
        if (typeof d.createdListingId === 'number') setCreatedListingId(d.createdListingId)
        if (Array.isArray(d.uploadedUrls)) setUploadedUrls(d.uploadedUrls)
        const hasContent = !!(d.hayType || d.selectedCounty || d.description || d.tonnage || d.pricePerTon || d.createdListingId)
        if (hasContent) setShowForm(true)
      }
    } catch { /* corrupt draft — ignore */ }
    setDraftRestored(true)
  }, [])

  // Persist the draft as it changes (create mode only — edits aren't drafts).
  useEffect(() => {
    if (!draftRestored || editingId != null) return
    const draft = {
      listingType, hayType, baleType, cuttingNumber, baleWeightLbs, storageMethod,
      tonnage, pricePerTon, showHayTest, hayTestProtein, hayTestTdn, hayTestMoisture,
      hayTestRfv, haulRadius, contact, description, reliefFlag, selectedCounty,
      createdListingId, uploadedUrls,
    }
    const hasContent = !!(hayType || selectedCounty || description || tonnage || pricePerTon || createdListingId)
    try {
      if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      else localStorage.removeItem(DRAFT_KEY)
    } catch { /* storage unavailable — best-effort */ }
  }, [draftRestored, editingId, listingType, hayType, baleType, cuttingNumber, baleWeightLbs,
      storageMethod, tonnage, pricePerTon, showHayTest, hayTestProtein, hayTestTdn,
      hayTestMoisture, hayTestRfv, haulRadius, contact, description, reliefFlag,
      selectedCounty, createdListingId, uploadedUrls])

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
  }

  // Deep link from the detail page ("Edit listing" → /hay?edit=<id>): once the
  // owner's listing is loaded, open the form pre-filled. Runs once.
  const editParam = searchParams.get('edit')
  const editLoadedRef = useRef(false)
  useEffect(() => {
    if (!editParam || editLoadedRef.current) return
    const target = listings.find(l => String(l.id) === editParam && l.mine)
    if (target) { editLoadedRef.current = true; loadIntoForm(target) }
  }, [editParam, listings]) // eslint-disable-line react-hooks/exhaustive-deps

  async function compressImage(file: File, maxMB = 4): Promise<File> {
    return new Promise((resolve) => {
      const maxBytes = maxMB * 1024 * 1024
      if (file.size <= maxBytes) { resolve(file); return }
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        let { width, height } = img
        // Scale down proportionally until estimated size is under limit
        const scale = Math.sqrt(maxBytes / file.size) * 0.9
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return }
            resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          },
          'image/jpeg',
          0.85,
        )
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
      img.src = url
    })
  }

  // Upload each pending photo; report which succeeded and which failed so the
  // caller can surface a clear error and let the seller retry only the failures.
  async function uploadPhotos(listingId: string): Promise<{ urls: string[]; failed: File[] }> {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user || photoFiles.length === 0) return { urls: [], failed: [] }

    const urls: string[] = []
    const failed: File[] = []
    for (const file of photoFiles) {
      try {
        const compressed = await compressImage(file)
        const path = `${user.id}/${listingId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        const { error } = await supabase.storage
          .from('hay-photos')
          .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
        if (error) { failed.push(file); continue }
        const { data: { publicUrl } } = supabase.storage.from('hay-photos').getPublicUrl(path)
        urls.push(publicUrl)
      } catch {
        failed.push(file)
      }
    }
    return { urls, failed }
  }

  function resetForm() {
    setSelectedCounty(null); setCountyQuery('')
    setListingType('sell'); setHayType('')
    setBaleType(''); setCuttingNumber(''); setBaleWeightLbs(''); setStorageMethod('')
    setTonnage(''); setPricePerTon('')
    setShowHayTest(false); setHayTestProtein(''); setHayTestTdn(''); setHayTestMoisture(''); setHayTestRfv('')
    setHaulRadius(''); setContact(''); setDescription(''); setReliefFlag(false)
    setPhotoFiles([]); setPhotoUrls([])
    setFormError(''); setPhotoError('')
    setEditingId(null); setCreatedListingId(null); setUploadedUrls([])
    clearDraft()
  }

  // Pull an existing listing into the form for editing (PATCH on submit).
  function loadIntoForm(l: HayListing) {
    setEditingId(Number(l.id))
    setCreatedListingId(null); setUploadedUrls([]); setPhotoError('')
    if (l.counties) setSelectedCounty(l.counties)
    setListingType((l.listing_type as 'sell' | 'want' | 'donate') ?? 'sell')
    setHayType(l.hay_type ?? '')
    setBaleType(l.bale_type ?? '')
    setCuttingNumber(l.cutting_number != null ? String(l.cutting_number) : '')
    setBaleWeightLbs(l.bale_weight_lbs != null ? String(l.bale_weight_lbs) : '')
    setStorageMethod(l.storage_method ?? '')
    setTonnage(l.tonnage != null ? String(l.tonnage) : '')
    setPricePerTon(l.price_per_ton != null ? String(l.price_per_ton) : '')
    const hasTest = l.hay_test_protein_pct != null || l.hay_test_tdn_pct != null ||
                    l.hay_test_rfv != null || l.hay_test_moisture_pct != null
    setShowHayTest(hasTest)
    setHayTestProtein(l.hay_test_protein_pct != null ? String(l.hay_test_protein_pct) : '')
    setHayTestTdn(l.hay_test_tdn_pct != null ? String(l.hay_test_tdn_pct) : '')
    setHayTestMoisture(l.hay_test_moisture_pct != null ? String(l.hay_test_moisture_pct) : '')
    setHayTestRfv(l.hay_test_rfv != null ? String(l.hay_test_rfv) : '')
    setHaulRadius(l.haul_radius_miles != null ? String(l.haul_radius_miles) : '')
    setContact(l.contact ?? '')
    setDescription(l.description ?? '')
    setReliefFlag(!!l.relief_flag)
    setPhotoFiles([]); setPhotoUrls([])
    setFormError('')
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Shared field payload for create + edit.
  function buildPayload() {
    return {
      county_id:             selectedCounty ? Number(selectedCounty.id) : undefined,
      listing_type:          listingType,
      hay_type:              hayType.trim(),
      contact:               contact.trim(),
      tonnage:               tonnage           ? parseFloat(tonnage)    : null,
      price_per_ton:         pricePerTon       ? parseFloat(pricePerTon) : null,
      description:           description.trim() || null,
      haul_radius_miles:     haulRadius        ? parseInt(haulRadius)   : null,
      relief_flag:           reliefFlag,
      cutting_number:        cuttingNumber     ? parseInt(cuttingNumber) : null,
      bale_type:             baleType          || null,
      bale_weight_lbs:       baleWeightLbs     ? parseInt(baleWeightLbs) : null,
      storage_method:        storageMethod     || null,
      hay_test_protein_pct:  hayTestProtein    ? parseFloat(hayTestProtein)  : null,
      hay_test_tdn_pct:      hayTestTdn        ? parseFloat(hayTestTdn)      : null,
      hay_test_rfv:          hayTestRfv        ? parseInt(hayTestRfv)        : null,
      hay_test_moisture_pct: hayTestMoisture   ? parseFloat(hayTestMoisture) : null,
    }
  }

  // EDIT: PATCH the existing listing. Keeps id / created_at / URL; photos are
  // uploaded the same resilient way when newly added.
  async function submitEdit() {
    setFormError('')
    if (!selectedCounty) { setFormError('Select a county.'); return }
    if (!hayType.trim())  { setFormError('Hay type is required.'); return }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/hay/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setFormError((json as { error?: string }).error ?? 'Failed to save changes.')
        return
      }
      // Newly added photos on an edit → upload + merge.
      if (photoFiles.length > 0) {
        setPhotoUploading(true)
        const { urls, failed } = await uploadPhotos(String(editingId))
        if (urls.length > 0) {
          await fetch(`/api/hay/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo_urls: urls }),
          }).catch(() => {})
        }
        setPhotoUploading(false)
        if (failed.length > 0) {
          setPhotoFiles(failed); setPhotoUrls(failed.map(f => URL.createObjectURL(f)))
          setPhotoError(`Changes saved, but ${failed.length} photo${failed.length !== 1 ? 's' : ''} didn't upload. Tap "Retry photos".`)
          return
        }
      }
      resetForm()
      setShowForm(false)
      await fetchListings()
    } catch {
      setFormError('Network problem — your changes were not saved. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // CREATE: resilient create → upload → PATCH. Survives a dropped connection
  // between steps — the created listing id is remembered so a retry resumes the
  // photo upload instead of posting a duplicate, and failed photos are reported.
  async function submitListing() {
    if (editingId != null) return submitEdit()
    setFormError(''); setPhotoError('')
    if (!selectedCounty) { setFormError('Select a county.'); return }
    if (!hayType.trim())  { setFormError('Hay type is required.'); return }

    setSubmitting(true)
    try {
      // 1) Create the row (skip if a prior attempt already created it).
      let listingId = createdListingId
      if (listingId == null) {
        const res = await fetch('/api/hay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        }).catch(() => null)
        if (!res) { setFormError('Network problem — listing not posted. Try again.'); return }
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          setFormError((json as { error?: string }).error ?? 'Failed to post listing.')
          return
        }
        const { id } = await res.json().catch(() => ({})) as { id?: number }
        if (!id) { setFormError('Listing posted but no id returned — please refresh.'); return }
        listingId = id
        setCreatedListingId(id)
        trackEvent('hay_listing_posted', { hay_type: hayType.trim().toLowerCase() })
      }

      // 2) Upload any pending photos, then 3) PATCH the merged urls.
      if (photoFiles.length > 0) {
        setPhotoUploading(true)
        const { urls, failed } = await uploadPhotos(String(listingId))
        const merged = [...uploadedUrls, ...urls]
        let patchFailed = false
        if (urls.length > 0) {
          const pr = await fetch(`/api/hay/${listingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo_urls: merged }),
          }).catch(() => null)
          if (pr && pr.ok) setUploadedUrls(merged)
          else patchFailed = true
        }
        setPhotoUploading(false)

        if (failed.length > 0 || patchFailed) {
          const stuck = patchFailed ? photoFiles : failed
          setPhotoFiles(stuck)
          setPhotoUrls(stuck.map(f => URL.createObjectURL(f)))
          setPhotoError(
            `Your listing is posted${uploadedUrls.length + urls.length > 0 ? ' with ' + (uploadedUrls.length + (patchFailed ? 0 : urls.length)) + ' photo(s)' : ''}, ` +
            `but ${stuck.length} photo${stuck.length !== 1 ? 's' : ''} didn't upload. Tap "Retry photos".`,
          )
          return // keep the form open + createdListingId so retry resumes
        }
      }

      // Full success.
      resetForm()
      setShowForm(false)
      await fetchListings()
    } finally {
      setSubmitting(false)
    }
  }

  // ── One-tap freshness actions on the seller's own listing ──────────────────
  function setFresh(id: string, on: boolean) {
    setFreshBusy(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n })
  }
  async function confirmStillAvailable(id: string) {
    setFresh(id, true)
    await fetch(`/api/hay/${id}/confirm`, { method: 'POST' }).catch(() => {})
    await fetchListings()
    setFresh(id, false)
  }
  async function markSoldExternal(id: string) {
    setFresh(id, true)
    await fetch(`/api/hay/${id}/sold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer: 'external' }),
    }).catch(() => {})
    await fetchListings()
    setFresh(id, false)
  }

  async function removeListing(id: string) {
    setRemoving(prev => new Set(prev).add(id))
    await fetch('/api/hay', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
    setListings(prev => prev.filter(l => l.id !== id))
    setRemoving(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  // Effective buyer county: explicit deliver-to override, else watchlist county.
  const buyerCounty = deliverCounty ?? watchlistCounty
  const buyerPoint = buyerCounty && buyerCounty.lat != null && buyerCounty.lon != null
    ? { lat: buyerCounty.lat, lon: buyerCounty.lon }
    : null
  // Default to delivered-price sort once a buyer county is known; respect manual choice.
  const effectiveSort: SortKey = sortChosen ?? (buyerPoint ? 'delivered' : 'newest')

  function applyDeliverCounty(c: HayCounty | null) {
    setDeliverCounty(c)
    deliverFipsRef.current = c?.fips ?? null
    setEditingDeliver(false)
    setDeliverQuery('')
    setDeliverResults([])
    setDeliverDropOpen(false)
    const p = new URLSearchParams()
    if (filterState)   p.set('state', filterState)
    if (filterVariety) p.set('variety', filterVariety)
    if (filterType)    p.set('type', filterType)
    if (c)             p.set('deliverTo', c.fips)
    router.replace(`/hay${p.toString() ? '?' + p.toString() : ''}`, { scroll: false })
  }

  async function saveSearch() {
    setSaving(true); setSaveError(''); setSaveDone(false)
    try {
      const res = await fetch('/api/radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state:              filterState || null,
          hay_type:           filterVariety || null,
          listing_type:       saveType || null,
          max_price_per_ton:  saveMaxPrice ? Number(saveMaxPrice) : null,
          max_distance_miles: saveMaxDist ? Number(saveMaxDist) : null,
          origin_county_id:   buyerCounty?.id ?? null,
          label:              saveLabel || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveError((j as { error?: string }).error ?? 'Could not save search.')
        return
      }
      trackEvent('alert_optin', { type: 'radar' })
      setShowSave(false)
      setSaveLabel(''); setSaveMaxPrice(''); setSaveMaxDist(''); setSaveType('')
      setSaveDone(true)
      setTimeout(() => setSaveDone(false), 3500)
    } finally {
      setSaving(false)
    }
  }

  const sellListings = listings.filter(l => l.listing_type !== 'want')
  const wantListings = listings.filter(l => l.listing_type === 'want')
  const baseFiltered = tab === 'sell' ? sellListings : wantListings
  const filtered = baseFiltered
    .filter(l => !filterState   || l.counties?.state === filterState)
    .filter(l => !filterVariety || (l.hay_type ?? '').toLowerCase() === filterVariety.toLowerCase())
    .filter(l => !filterType    || l.listing_type === filterType)

  // Sort. 'newest' keeps API order (created_at desc). Listings without a
  // delivered cost (no buyer county / no price / want) sort to the end.
  const sorted = [...filtered]
  if (effectiveSort === 'delivered') {
    sorted.sort((a, b) => {
      const da = deliveredCost(buyerPoint, a)?.delivered ?? Number.POSITIVE_INFINITY
      const db = deliveredCost(buyerPoint, b)?.delivered ?? Number.POSITIVE_INFINITY
      return da - db
    })
  } else if (effectiveSort === 'price') {
    sorted.sort((a, b) => (a.price_per_ton ?? Number.POSITIVE_INFINITY) - (b.price_per_ton ?? Number.POSITIVE_INFINITY))
  }

  const availableStates    = [...new Set(listings.map(l => l.counties?.state).filter(Boolean))].sort() as string[]
  const availableVarieties = [...new Set(listings.map(l => l.hay_type).filter(Boolean))].sort() as string[]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={2}>
              Hay Network
            </Heading>
            <p className="mt-1 text-sm text-forest-green/50 font-dm-sans">
              Drought-aware hay listings. Buyers and sellers connect offline.
            </p>
          </div>

          {/* List / Map toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-forest-green/20 bg-white p-1">
            <Link
              href="/hay"
              className="rounded-md px-3 py-1 font-dm-sans text-xs font-medium text-forest-green bg-forest-green/8"
            >
              List
            </Link>
            <Link
              href="/hay/map"
              className="rounded-md px-3 py-1 font-dm-sans text-xs font-medium text-forest-green/50 hover:text-forest-green transition-colors"
            >
              Map
            </Link>
          </div>

          {authed ? (
            <button
              onClick={() => { if (showForm) { resetForm(); setShowForm(false) } else { setShowForm(true) } }}
              className="rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
            >
              {showForm ? 'Cancel' : '+ Post a listing'}
            </button>
          ) : (
            <Link
              href="/signin"
              className="rounded-lg border border-forest-green/20 px-4 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-forest-green/5 transition-colors"
            >
              Sign in to post
            </Link>
          )}
        </div>

        {/* ── Post form ──────────────────────────────────────────────────── */}
        {showForm && authed && (
          <Card className="mt-6 px-5 py-6">
            <Heading level={5} className="mb-5">
              {editingId != null ? 'Edit listing' : 'New listing'}
            </Heading>

            {/* Group 1: Core */}
            <div className="grid gap-4 sm:grid-cols-2">

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">County *</label>
                {selectedCounty ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg border border-forest-green/20 px-3 py-2 text-sm font-dm-sans text-forest-green bg-cream">
                      {selectedCounty.name}, {selectedCounty.state}
                    </span>
                    <button type="button" onClick={() => { setSelectedCounty(null); setCountyQuery('') }}
                      className="text-xs font-dm-sans text-forest-green/50 hover:text-forest-green">
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={countyQuery} onChange={e => setCountyQuery(e.target.value)}
                      onBlur={() => setTimeout(() => setCountyDropOpen(false), 150)}
                      placeholder="Search county — e.g. Lincoln, NE" className={INPUT_CLS} />
                    {countyDropOpen && (
                      <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-forest-green/15 bg-white shadow-lg">
                        {countyResults.map(c => (
                          <li key={c.fips}>
                            <button type="button"
                              onMouseDown={() => { setSelectedCounty(c); setCountyQuery(''); setCountyDropOpen(false) }}
                              className="w-full px-4 py-2.5 text-left text-sm font-dm-sans text-forest-green hover:bg-cream">
                              {c.name}, {c.state}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Type *</label>
                <div className="flex gap-4">
                  {(['sell', 'want', 'donate'] as const).map(t => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="listing_type" value={t} checked={listingType === t}
                        onChange={() => setListingType(t)} className="accent-forest-green" />
                      <span className="text-sm font-dm-sans text-forest-green capitalize">{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Hay type *</label>
                <input list="hay-types" value={hayType} onChange={e => setHayType(e.target.value)}
                  placeholder="e.g. Alfalfa" className={INPUT_CLS} />
                <datalist id="hay-types">{HAY_TYPES.map(t => <option key={t} value={t} />)}</datalist>
              </div>
            </div>

            {/* Group 2: Quality details */}
            <div className="mt-5 border-t border-forest-green/8 pt-5">
              <p className="text-xs font-semibold text-forest-green/50 font-dm-sans uppercase tracking-wide mb-4">Quality Details</p>
              <div className="grid gap-4 sm:grid-cols-2">

                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Bale type</label>
                  <select value={baleType} onChange={e => setBaleType(e.target.value)} className={SELECT_CLS}>
                    <option value="">— Select —</option>
                    <option value="small_square_2string">Small Square (2-string)</option>
                    <option value="small_square_3string">Small Square (3-string)</option>
                    <option value="large_square_3x3">Large Square (3x3)</option>
                    <option value="large_square_3x4">Large Square (3x4)</option>
                    <option value="large_square_4x4">Large Square (4x4)</option>
                    <option value="round_4x4">Round (4x4)</option>
                    <option value="round_5x6">Round (5x6)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Cutting</label>
                  <select value={cuttingNumber} onChange={e => setCuttingNumber(e.target.value)} className={SELECT_CLS}>
                    <option value="">— Unknown —</option>
                    <option value="1">1st cutting</option>
                    <option value="2">2nd cutting</option>
                    <option value="3">3rd cutting</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Bale weight</label>
                  <input type="number" min="0" step="1" value={baleWeightLbs}
                    onChange={e => setBaleWeightLbs(e.target.value)}
                    placeholder="lbs per bale (optional)" className={INPUT_CLS} />
                </div>

                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Storage method</label>
                  <select value={storageMethod} onChange={e => setStorageMethod(e.target.value)} className={SELECT_CLS}>
                    <option value="">— Select —</option>
                    <option value="barn">Barn</option>
                    <option value="covered">Covered</option>
                    <option value="outside">Outside</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Group 3: Quantity + price */}
            <div className="mt-5 border-t border-forest-green/8 pt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Tonnage (optional)</label>
                  <input type="number" min="0" step="0.1" value={tonnage}
                    onChange={e => setTonnage(e.target.value)} placeholder="e.g. 50" className={INPUT_CLS} />
                </div>

                {listingType !== 'donate' && (
                  <div>
                    <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Price per ton, $ (optional)</label>
                    <input type="number" min="0" step="1" value={pricePerTon}
                      onChange={e => setPricePerTon(e.target.value)} placeholder="e.g. 180" className={INPUT_CLS} />
                  </div>
                )}
              </div>
            </div>

            {/* Group 4: Hay test (collapsible) */}
            <div className="mt-5 border-t border-forest-green/8 pt-5">
              <button
                type="button"
                onClick={() => setShowHayTest(v => !v)}
                className="flex w-full items-center justify-between text-sm font-medium font-dm-sans text-forest-green hover:text-forest-green/80 transition-colors"
              >
                <span>Add forage test results <span className="text-forest-green/40 font-normal">(optional)</span></span>
                <span className="text-forest-green/40 text-xs">{showHayTest ? '▲ Hide' : '▼ Show'}</span>
              </button>

              {showHayTest && (
                <>
                  <p className="mt-1.5 text-xs text-forest-green/50 font-dm-sans">
                    Adding test results builds buyer trust and gets your listing seen first.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Crude Protein %</label>
                      <input type="number" min="0" max="100" step="0.1" value={hayTestProtein}
                        onChange={e => setHayTestProtein(e.target.value)} placeholder="e.g. 14.2" className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">TDN %</label>
                      <input type="number" min="0" max="100" step="0.1" value={hayTestTdn}
                        onChange={e => setHayTestTdn(e.target.value)} placeholder="e.g. 58" className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Moisture %</label>
                      <input type="number" min="0" max="100" step="0.1" value={hayTestMoisture}
                        onChange={e => setHayTestMoisture(e.target.value)} placeholder="e.g. 12" className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">RFV</label>
                      <input type="number" min="0" step="1" value={hayTestRfv}
                        onChange={e => setHayTestRfv(e.target.value)} placeholder="e.g. 120" className={INPUT_CLS} />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Group 5: Contact + logistics */}
            <div className="mt-5 border-t border-forest-green/8 pt-5">
              <div className="grid gap-4 sm:grid-cols-2">

                {listingType !== 'want' ? (
                  <div>
                    <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Haul radius, miles (optional)</label>
                    <input type="number" min="0" step="1" value={haulRadius}
                      onChange={e => setHaulRadius(e.target.value)} placeholder="e.g. 100" className={INPUT_CLS} />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Source radius, miles (optional)</label>
                    <input type="number" min="0" step="1" value={haulRadius}
                      onChange={e => setHaulRadius(e.target.value)} placeholder="e.g. 150" className={INPUT_CLS} />
                    <p className="mt-1 text-xs text-forest-green/40 font-dm-sans">
                      How far you&apos;d haul hay from — leave blank for a 250-mile default.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                    Your contact info <span className="font-normal text-forest-green/35">(optional, private)</span>
                  </label>
                  <input type="text" value={contact} onChange={e => setContact(e.target.value)}
                    placeholder="Phone or email — for your records" className={INPUT_CLS} />
                  <p className="mt-1 text-xs text-forest-green/40 font-dm-sans">
                    Buyers reach you through Dryline messages, so this stays private — it&apos;s just for your own records.
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Details (optional)</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="Bale type, delivery info, pickup location…" rows={3}
                    className={`${INPUT_CLS} resize-none`} />
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={reliefFlag} onChange={e => setReliefFlag(e.target.checked)}
                      className="accent-forest-green h-4 w-4" />
                    <span className="text-sm font-dm-sans text-forest-green/70">
                      Disaster / drought relief — free or reduced-cost hay for hardship cases
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Group 6: Photos */}
            <div className="mt-5 border-t border-forest-green/8 pt-5">
              <p className="mb-1 font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
                Photos (up to 5)
              </p>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-forest-green/20 bg-forest-green/5 px-4 py-6 hover:border-forest-green/40 transition-colors">
                <svg className="h-6 w-6 text-forest-green/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="font-dm-sans text-xs text-forest-green/50">
                  {photoFiles.length === 0 ? 'Tap to add photos' : `${photoFiles.length} photo${photoFiles.length !== 1 ? 's' : ''} selected`}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  multiple
                  className="sr-only"
                  onChange={e => {
                    const files = Array.from(e.target.files ?? []).slice(0, 5)
                    setPhotoFiles(files)
                    setPhotoUrls(files.map(f => URL.createObjectURL(f)))
                  }}
                />
              </label>
              {photoUrls.length > 0 && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {photoUrls.map((url, i) => (
                    <div key={i} className="relative">
                      <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-forest-green/10" />
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoFiles(prev => prev.filter((_, j) => j !== i))
                          setPhotoUrls(prev => prev.filter((_, j) => j !== i))
                        }}
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-forest-green text-cream text-xs font-bold"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {formError && (
              <p className="mt-3 text-sm text-red-600 font-dm-sans">{formError}</p>
            )}

            {/* Photo upload partial failure — clear message + one-tap retry. */}
            {photoError && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                <p className="text-sm font-medium text-amber-800 font-dm-sans">{photoError}</p>
                <p className="mt-0.5 text-xs text-amber-700/80 font-dm-sans">
                  Your listing is saved either way — only the photos need another try.
                </p>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button onClick={submitListing} disabled={submitting || photoUploading}
                className="rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors">
                {photoUploading
                  ? 'Uploading photos…'
                  : submitting
                    ? (editingId != null ? 'Saving…' : 'Posting…')
                    : photoError
                      ? 'Retry photos'
                      : editingId != null
                        ? 'Save changes'
                        : 'Post listing'}
              </button>
              <button onClick={() => { resetForm(); setShowForm(false) }}
                className="rounded-lg border border-forest-green/20 px-5 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-cream transition-colors">
                {photoError ? 'Done (skip photos)' : 'Cancel'}
              </button>
            </div>

            <MarketplaceDisclaimer className="mt-5 border-t border-forest-green/10 pt-4" />
          </Card>
        )}

        {/* ── Deliver to ───────────────────────────────────────────────────── */}
        <Card shadow="none" className="mt-6 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-dm-sans text-xs font-semibold uppercase tracking-wide text-forest-green/50">
              Deliver to
            </span>
            {buyerCounty && !editingDeliver ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-cream px-3 py-1.5 font-dm-sans text-sm font-medium text-forest-green">
                  {buyerCounty.name}, {buyerCounty.state}
                </span>
                {!deliverCounty && (
                  <span className="font-dm-sans text-xs text-forest-green/40">your watched county</span>
                )}
                <button
                  onClick={() => { setEditingDeliver(true); setDeliverQuery('') }}
                  className="font-dm-sans text-xs text-forest-green/60 underline hover:text-forest-green"
                >
                  Change
                </button>
                {deliverCounty && (
                  <button
                    onClick={() => applyDeliverCounty(null)}
                    className="font-dm-sans text-xs text-forest-green/40 hover:text-forest-green"
                  >
                    Clear
                  </button>
                )}
              </div>
            ) : (
              <div className="relative min-w-[220px] flex-1">
                <input
                  value={deliverQuery}
                  onChange={e => setDeliverQuery(e.target.value)}
                  onBlur={() => setTimeout(() => setDeliverDropOpen(false), 150)}
                  placeholder="Search your county — e.g. Lincoln, NE"
                  className={INPUT_CLS}
                />
                {deliverDropOpen && (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-forest-green/15 bg-white shadow-lg">
                    {deliverResults.map(c => (
                      <li key={c.fips}>
                        <button
                          type="button"
                          onMouseDown={() => applyDeliverCounty(c)}
                          className="w-full px-4 py-2.5 text-left text-sm font-dm-sans text-forest-green hover:bg-cream"
                        >
                          {c.name}, {c.state}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {buyerCounty && editingDeliver && (
                  <button
                    onClick={() => { setEditingDeliver(false); setDeliverQuery('') }}
                    className="mt-1 font-dm-sans text-xs text-forest-green/40 hover:text-forest-green"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="mt-2 font-dm-sans text-xs text-forest-green/50">
            {buyerPoint
              ? 'Prices below show est. delivered cost per ton to this county (assumes full truckload).'
              : 'Set your county to see est. delivered cost per ton — freight included.'}
          </p>
        </Card>

        {/* Tab bar */}
        <div className="mt-6 flex gap-1 rounded-lg bg-forest-green/5 p-1 w-fit">
          {(['sell', 'want'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={[
                'rounded-md px-4 py-1.5 text-sm font-dm-sans font-medium transition-colors',
                tab === t ? 'bg-white text-forest-green shadow-sm' : 'text-forest-green/50 hover:text-forest-green',
              ].join(' ')}>
              {t === 'sell'
                ? `For Sale${sellListings.length > 0 ? ` (${sellListings.length})` : ''}`
                : `Wanted${wantListings.length > 0 ? ` (${wantListings.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* Listings */}
        <div className="mt-4">
          {/* Filter bar */}
          {!listingsLoading && listings.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <select
                value={filterState}
                onChange={e => { setFilterState(e.target.value); pushFilters(e.target.value, filterVariety, filterType) }}
                className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 font-dm-sans text-xs text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
              >
                <option value="">All states</option>
                {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select
                value={filterVariety}
                onChange={e => { setFilterVariety(e.target.value); pushFilters(filterState, e.target.value, filterType) }}
                className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 font-dm-sans text-xs text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
              >
                <option value="">All varieties</option>
                {availableVarieties.map(v => <option key={v} value={v}>{v}</option>)}
              </select>

              <select
                value={filterType}
                onChange={e => { setFilterType(e.target.value); pushFilters(filterState, filterVariety, e.target.value) }}
                className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 font-dm-sans text-xs text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
              >
                <option value="">For sale &amp; wanted</option>
                <option value="sell">For sale only</option>
                <option value="want">Wanted only</option>
              </select>

              <select
                value={effectiveSort}
                onChange={e => setSortChosen(e.target.value as SortKey)}
                className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 font-dm-sans text-xs text-forest-green focus:outline-none focus:ring-2 focus:ring-forest-green/30"
              >
                <option value="delivered" disabled={!buyerPoint}>
                  {buyerPoint ? 'Delivered price (low→high)' : 'Delivered price — set county'}
                </option>
                <option value="newest">Newest</option>
                <option value="price">Listing price (low→high)</option>
              </select>

              {(filterState || filterVariety || filterType) && (
                <button
                  onClick={() => { setFilterState(''); setFilterVariety(''); setFilterType(''); pushFilters('', '', '') }}
                  className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs text-forest-green/50 hover:text-forest-green transition-colors"
                >
                  Clear filters ×
                </button>
              )}

              {authed ? (
                <button
                  onClick={() => { setShowSave(v => !v); setSaveError('') }}
                  className="rounded-lg border border-forest-green/30 bg-forest-green/5 px-3 py-1.5 font-dm-sans text-xs font-medium text-forest-green hover:bg-forest-green/10 transition-colors"
                >
                  {showSave ? 'Cancel' : '🔔 Save this search'}
                </button>
              ) : (
                <Link
                  href="/signin"
                  className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs text-forest-green/60 hover:text-forest-green transition-colors"
                >
                  Sign in to save this search
                </Link>
              )}
              {saveDone && (
                <span className="inline-flex items-center font-dm-sans text-xs font-medium text-forest-green">
                  Saved — see it on <Link href="/radar" className="ml-1 underline">Hay Radar</Link>
                </span>
              )}
            </div>
          )}

          {/* Save-this-search panel */}
          {showSave && authed && !listingsLoading && listings.length > 0 && (
            <div className="mb-4 rounded-xl border border-forest-green/15 bg-white px-4 py-4 shadow-sm">
              <p className="font-dm-sans text-sm font-semibold text-forest-green">Save this search to Hay Radar</p>
              <p className="mt-0.5 font-dm-sans text-xs text-forest-green/55">
                We&apos;ll email you when a new listing matches. Uses your current filters
                {filterState || filterVariety ? ` (${[filterVariety, filterState].filter(Boolean).join(', ')})` : ' (all listings)'}.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Name (optional)</label>
                  <input value={saveLabel} onChange={e => setSaveLabel(e.target.value)} maxLength={80}
                    placeholder="e.g. Alfalfa near home" className={INPUT_CLS} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Listing type</label>
                  <select value={saveType} onChange={e => setSaveType(e.target.value as '' | 'sell' | 'donate')} className={SELECT_CLS}>
                    <option value="">Any (sale + donations)</option>
                    <option value="sell">For sale only</option>
                    <option value="donate">Donations only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">Max price $/ton (optional)</label>
                  <input type="number" min="0" step="1" value={saveMaxPrice} onChange={e => setSaveMaxPrice(e.target.value)}
                    placeholder="e.g. 180" className={INPUT_CLS} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-forest-green/60 font-dm-sans mb-1">
                    Max distance, miles {buyerCounty ? `from ${buyerCounty.name}, ${buyerCounty.state}` : ''}
                  </label>
                  <input type="number" min="0" step="1" value={saveMaxDist} onChange={e => setSaveMaxDist(e.target.value)}
                    placeholder={buyerCounty ? 'e.g. 150' : 'Set a county above first'} disabled={!buyerCounty}
                    className={`${INPUT_CLS} disabled:opacity-50`} />
                  {!buyerCounty && (
                    <p className="mt-1 font-dm-sans text-xs text-forest-green/40">
                      Set a &ldquo;Deliver to&rdquo; county above to filter by distance.
                    </p>
                  )}
                </div>
              </div>
              {saveError && <p className="mt-2 font-dm-sans text-sm text-rust">{saveError}</p>}
              <div className="mt-3 flex gap-3">
                <button onClick={saveSearch} disabled={saving}
                  className="rounded-lg bg-forest-green px-5 py-2 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors">
                  {saving ? 'Saving…' : 'Save search'}
                </button>
                <button onClick={() => { setShowSave(false); setSaveError('') }}
                  className="rounded-lg border border-forest-green/20 px-5 py-2 font-dm-sans text-sm font-medium text-forest-green hover:bg-cream transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {listingsLoading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-24 rounded-xl bg-forest-green/8 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-forest-green/20 bg-white px-6 py-12 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-forest-green/8">
                    <svg className="h-6 w-6 text-forest-green/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                  </div>
                  <p className="font-fraunces text-base font-semibold text-forest-green">
                    {(filterState || filterVariety || filterType) ? 'No listings match these filters' : 'No hay listings yet'}
                  </p>
                  <p className="mt-1 font-dm-sans text-sm text-forest-green/50">
                    {(filterState || filterVariety || filterType)
                      ? <button onClick={() => { setFilterState(''); setFilterVariety(''); setFilterType(''); pushFilters('', '', '') }} className="underline hover:text-forest-green">Clear filters</button>
                      : 'Be the first to post hay for sale in your area.'
                    }
                  </p>
                  {!authed && (
                    <p className="mt-3 font-dm-sans text-sm text-forest-green/50">
                      <Link href="/signin" className="underline hover:text-forest-green">Sign in</Link> to post a listing.
                    </p>
                  )}
                </div>
          ) : (
            <ul className="space-y-3">
              {sorted.map(l => {
                const county  = l.counties
                const daysLeft = Math.max(0, Math.ceil(
                  (new Date(l.expires_at ?? Date.now()).getTime() - Date.now()) / 86400000,
                ))
                // Freshness from existing fields: a listing starts (and each
                // "still available" confirm resets it) to 30 days left, so
                // days-since-activity = 30 − daysLeft. Posted-age is honest from created_at.
                const daysSinceActivity = Math.max(0, LISTING_TTL_DAYS - daysLeft)
                const postedDaysAgo = Math.max(0, Math.floor(
                  (Date.now() - new Date(l.created_at).getTime()) / 86400000,
                ))
                const ownerShouldConfirm = l.mine && daysSinceActivity >= STALE_NUDGE_DAYS
                const looksStale = daysSinceActivity >= STALE_BUYER_DAYS
                const badge = l.droughtTier !== null ? DROUGHT_BADGE[l.droughtTier] : null
                const dc = deliveredCost(buyerPoint, l)
                const dist  =
                  buyerPoint && county != null && county.lat != null && county.lon != null
                    ? Math.round(haversine(buyerPoint.lat, buyerPoint.lon, county.lat, county.lon))
                    : null

                const priceLabel =
                  l.listing_type === 'donate'
                    ? 'Donation'
                    : l.price_per_ton != null
                      ? `$${l.price_per_ton.toFixed(0)}/ton`
                      : 'Price TBD'

                const hasTest =
                  l.hay_test_protein_pct  != null ||
                  l.hay_test_tdn_pct      != null ||
                  l.hay_test_rfv          != null ||
                  l.hay_test_moisture_pct != null

                const contactLabel = l.listing_type === 'want' ? 'Contact' : 'Message'

                return (
                  <Card
                    as="li"
                    key={l.id}
                    onClick={() => router.push(`/hay/${l.id}${buyerCounty ? `?deliverTo=${buyerCounty.fips}` : ''}`)}
                    className="cursor-pointer"
                  >
                    {l.photo_urls && l.photo_urls.length > 0 && (
                      <div className="relative h-32 w-full overflow-hidden rounded-t-xl">
                        <img
                          src={l.photo_urls[0]}
                          alt={`${l.hay_type ?? 'Hay'} listing photo`}
                          className="h-full w-full object-cover"
                        />
                        {l.photo_urls.length > 1 && (
                          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/50 px-1.5 py-0.5 font-dm-sans text-xs text-white">
                            +{l.photo_urls.length - 1} more
                          </span>
                        )}
                      </div>
                    )}
                    {l.mine && l.claim_status === 'pending' && (
                      <div className="mx-4 mt-4 rounded-lg border border-rust/40 bg-rust/5 px-3 py-2 sm:mx-5">
                        <p className="font-dm-sans text-xs font-semibold text-rust">
                          A buyer claims they purchased this — tap to confirm or reject
                        </p>
                      </div>
                    )}
                    {/* Staleness nudge — owner's own, aging listing. One-tap confirm or sold. */}
                    {ownerShouldConfirm && l.claim_status !== 'pending' && (
                      <div
                        onClick={e => e.stopPropagation()}
                        className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 sm:mx-5"
                      >
                        <p className="font-dm-sans text-xs font-medium text-amber-800">
                          Still have this hay? You posted it {postedDaysAgo} days ago — confirm it&apos;s available so buyers know it&apos;s current.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => confirmStillAvailable(l.id)}
                            disabled={freshBusy.has(l.id)}
                            className="rounded-lg bg-forest-green px-3 py-1.5 text-xs font-medium text-cream font-dm-sans hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
                          >
                            {freshBusy.has(l.id) ? '…' : 'Yes, still available'}
                          </button>
                          <button
                            onClick={() => markSoldExternal(l.id)}
                            disabled={freshBusy.has(l.id)}
                            className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 text-xs font-medium text-forest-green font-dm-sans hover:bg-cream disabled:opacity-50 transition-colors"
                          >
                            Mark sold
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="px-4 py-4 sm:px-5 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">

                        {/* Title + badges row */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Heading level={5}>
                            {l.hay_type}
                            {l.cutting_number != null && (
                              <span className="font-dm-sans text-sm font-normal text-forest-green/60 ml-1">
                                — {ORDINALS[l.cutting_number]} cut
                              </span>
                            )}
                          </Heading>
                          {l.listing_type === 'donate' && (
                            <span className="inline-flex items-center rounded-full bg-forest-green/10 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green ring-1 ring-forest-green/20">
                              Donation
                            </span>
                          )}
                          {l.relief_flag && (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-red-700 ring-1 ring-red-200">
                              Relief
                            </span>
                          )}
                          {l.bale_type && (
                            <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                              {BALE_TYPE_LABELS[l.bale_type] ?? l.bale_type}
                            </span>
                          )}
                          {l.storage_method === 'barn' && (
                            <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                              Barn stored
                            </span>
                          )}
                          {l.storage_method === 'covered' && (
                            <span className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-medium font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                              Covered
                            </span>
                          )}
                          {hasTest && (
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium font-dm-sans text-green-700 ring-1 ring-green-200">
                              Hay test
                            </span>
                          )}
                          {badge && (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-dm-sans ring-1 ${badge.cls}`}>
                              {badge.label} Drought
                            </span>
                          )}
                        </div>

                        {/* Location */}
                        <p className="mt-1 text-sm text-forest-green/60 font-dm-sans">
                          {county?.name}, {county?.state}
                          {dist !== null && !dc && (
                            <span className="ml-1 text-forest-green/40">· {dist} mi away</span>
                          )}
                        </p>

                        {/* Price — delivered headline when a buyer county is known */}
                        {dc ? (
                          <div className="mt-1.5">
                            <p className="font-fraunces text-xl font-semibold text-forest-green leading-none">
                              ${dc.delivered}
                              <span className="ml-1 font-dm-sans text-xs font-medium text-forest-green/60">/ton est. delivered</span>
                            </p>
                            <p className="mt-1 text-xs text-forest-green/50 font-dm-sans">
                              ${dc.base}/ton hay + ~${dc.freightPerTon}/ton est. freight · ~{dc.miles} mi
                            </p>
                          </div>
                        ) : (
                          <p className="mt-1.5 font-fraunces text-base font-semibold text-forest-green">
                            {priceLabel}
                          </p>
                        )}

                        {/* Meta row */}
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-forest-green/50 font-dm-sans">
                          {l.tonnage != null && <span>{l.tonnage} tons</span>}
                          {l.haul_radius_miles != null && (
                            <span>Hauls up to {l.haul_radius_miles} mi</span>
                          )}
                        </div>

                        {l.description && (
                          <p className="mt-2 text-sm text-forest-green/70 font-dm-sans line-clamp-2">
                            {l.description}
                          </p>
                        )}
                      </div>

                      {/* Right column — action buttons (z-10 to sit above the stretched link) */}
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {/* Listing age — surfaced so buyers can judge freshness. */}
                        <span className={`text-xs font-dm-sans ${looksStale ? 'text-amber-600' : 'text-forest-green/40'}`}>
                          Posted {postedDaysAgo === 0 ? 'today' : `${postedDaysAgo}d ago`}
                          {looksStale && ' · may be stale'}
                        </span>

                        <button
                          onClick={e => { e.stopPropagation(); router.push(`/hay/${l.id}${buyerCounty ? `?deliverTo=${buyerCounty.fips}` : ''}`) }}
                          className="rounded-lg bg-forest-green px-3 py-1.5 text-xs font-medium text-cream font-dm-sans hover:bg-forest-green/90 transition-colors"
                        >
                          {contactLabel}
                        </button>

                        {l.mine && (
                          <div className="flex gap-2">
                            <button
                              onClick={e => { e.stopPropagation(); loadIntoForm(l) }}
                              className="rounded-lg border border-forest-green/20 px-3 py-1.5 text-xs font-medium text-forest-green font-dm-sans hover:bg-cream transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); removeListing(l.id) }}
                              disabled={removing.has(l.id)}
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 font-dm-sans hover:bg-red-50 disabled:opacity-40"
                            >
                              {removing.has(l.id) ? '…' : 'Remove'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Trust strip */}
                      {(l.display_name || l.verified_phone || (l.seller_review_count ?? 0) > 0 || (l.seller_listing_count ?? 0) > 0) && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-forest-green/8 pt-3 w-full">
                          {l.display_name && (
                            <span className="font-dm-sans text-xs text-forest-green/60">{l.display_name}</span>
                          )}
                          {l.verified_phone && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-forest-green/8 px-2 py-0.5 font-dm-sans text-xs font-medium text-forest-green">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Phone verified
                            </span>
                          )}
                          {(l.seller_avg_rating ?? 0) > 0 && (l.seller_review_count ?? 0) > 0 && (
                            <span className="font-dm-sans text-xs text-forest-green/60">
                              {'★'.repeat(Math.round(l.seller_avg_rating ?? 0))}{'☆'.repeat(5 - Math.round(l.seller_avg_rating ?? 0))} ({l.seller_review_count})
                            </span>
                          )}
                          {(l.seller_listing_count ?? 0) > 0 && (
                            <span className="font-dm-sans text-xs text-forest-green/40">{l.seller_listing_count} sale{(l.seller_listing_count ?? 0) !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </ul>
          )}
        </div>

      </main>
    <SiteFooter />
    </>
  )
}

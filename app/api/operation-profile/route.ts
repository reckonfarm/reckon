import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  getOperationProfile,
  upsertOperationProfile,
  type OperationProfileInput,
  type Json,
} from '@/lib/operation-profile-service'
import { normalizeHerd } from '@/lib/herd'

// Thin verification route over the operation_profiles data layer. The auth + RLS
// scoping live entirely in lib/operation-profile-service.ts, which uses the user-scoped
// SSR client (NOT service-role) so the RLS policies do the access control — this route
// just maps the discriminated service result onto HTTP. No UI yet.

// GET /api/operation-profile → the current user's profile result
//   401 unauthenticated · 503 data_unavailable · 200 { status: 'ok' | 'empty', … }
export async function GET() {
  const result = await getOperationProfile()

  if (result.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (result.status === 'data_unavailable') {
    return NextResponse.json(result, { status: 503 })
  }
  return NextResponse.json(result)
}

// PATCH /api/operation-profile  { county_fips?, herd?, crops? } → upserts the caller's row
//   401 unauthenticated · 400 bad body · 503 data_unavailable · 200 { status:'ok', profile }
// user_id is taken from the session inside the service — it can NOT be set via the body.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Whitelist the three writable fields; only forward keys actually present so a partial
  // PATCH leaves the others untouched. Validate shape before writing.
  const input: OperationProfileInput = {}

  if ('county_fips' in body) {
    const fips = (body as { county_fips: unknown }).county_fips
    if (fips !== null && !(typeof fips === 'string' && /^\d{5}$/.test(fips))) {
      return NextResponse.json({ error: 'county_fips must be a 5-digit string or null' }, { status: 400 })
    }
    input.county_fips = fips as string | null
  }

  // crops stays generic jsonb — accept an object, array, or null (reject bare primitives so
  // a stray string/number can't land in the column). Not typed yet.
  if ('crops' in body) {
    const val = (body as Record<string, unknown>).crops
    if (val !== null && typeof val !== 'object') {
      return NextResponse.json({ error: 'crops must be an object, array, or null' }, { status: 400 })
    }
    input.crops = val as Json
  }

  // herd is the typed lot structure (lib/herd.ts). null clears it; otherwise normalizeHerd
  // rejects malformed lots and fills defaults/timestamps on sparse ones. We store the
  // NORMALIZED herd so defaults persist instead of being re-derived on every read.
  if ('herd' in body) {
    const val = (body as Record<string, unknown>).herd
    if (val === null) {
      input.herd = null
    } else {
      const result = normalizeHerd(val)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      input.herd = result.herd as unknown as Json
    }
  }

  if (Object.keys(input).length === 0) {
    return NextResponse.json({ error: 'Nothing to update (provide county_fips, herd, and/or crops)' }, { status: 400 })
  }

  const result = await upsertOperationProfile(input)

  if (result.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (result.status === 'data_unavailable') {
    return NextResponse.json(result, { status: 503 })
  }
  return NextResponse.json(result)
}

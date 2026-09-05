import 'server-only'
import { createServiceClient } from './supabase'

// ─── hay-photos: private bucket, signed reads (Block 1C step 6) ───────────────
//
// The bucket holds ranchers' own listing photos, so it is PRIVATE: nothing is
// reachable by bare URL. Every read goes through here and gets a signed URL
// good for one hour, minted with the service role at request time. Rows may
// carry either a storage PATH (new uploads: `<user>/<listing>/<file>.jpg`) or
// a legacy PUBLIC URL from when the bucket was public — both resolve to the
// same object; the public form is just reduced to its path before signing.
// A failed sign yields no URL for that photo (never a broken public link).

export const HAY_PHOTOS_BUCKET = 'hay-photos'
export const SIGNED_URL_TTL_SECONDS = 60 * 60

const PUBLIC_PREFIX = `/storage/v1/object/public/${HAY_PHOTOS_BUCKET}/`

/** Storage path for a stored value — a bare path, or the path inside a legacy public URL. */
export function toStoragePath(stored: string): string | null {
  const s = stored.trim()
  if (!s) return null
  const i = s.indexOf(PUBLIC_PREFIX)
  if (i >= 0) return decodeURIComponent(s.slice(i + PUBLIC_PREFIX.length).split('?')[0])
  if (/^https?:\/\//i.test(s)) return null   // some other host — not ours to sign
  return s.replace(/^\/+/, '')
}

/**
 * Sign many stored values in one call (one storage round-trip per request, not
 * per photo). Returns a map stored-value → signed URL; values that could not be
 * signed are absent.
 */
export async function signHayPhotoMap(stored: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const pathByStored = new Map<string, string>()
  for (const s of stored) {
    const p = toStoragePath(s)
    if (p) pathByStored.set(s, p)
  }
  const paths = [...new Set(pathByStored.values())]
  if (paths.length === 0) return out
  try {
    const { data, error } = await createServiceClient().storage
      .from(HAY_PHOTOS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    if (error || !data) return out
    const signedByPath = new Map<string, string>()
    for (const d of data) if (d.signedUrl && d.path) signedByPath.set(d.path, d.signedUrl)
    for (const [s, p] of pathByStored) {
      const u = signedByPath.get(p)
      if (u) out.set(s, u)
    }
  } catch {
    // leave unsigned photos absent
  }
  return out
}

/** Sign one row's photo list. */
export async function signHayPhotos(stored: readonly string[] | null | undefined): Promise<string[]> {
  if (!stored || stored.length === 0) return []
  const m = await signHayPhotoMap(stored)
  return stored.map(s => m.get(s)).filter((u): u is string => !!u)
}

/** Sign photos across many rows with a single storage call. */
export async function signHayPhotosForRows<T extends { photo_urls?: string[] | null }>(
  rows: readonly T[],
): Promise<Map<T, string[]>> {
  const all = rows.flatMap(r => r.photo_urls ?? [])
  const m = await signHayPhotoMap(all)
  const out = new Map<T, string[]>()
  for (const r of rows) {
    out.set(r, (r.photo_urls ?? []).map(s => m.get(s)).filter((u): u is string => !!u))
  }
  return out
}

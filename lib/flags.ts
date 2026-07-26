// ─── Feature flags — env-read, DEFAULT ON ────────────────────────────────────────────────
//
// The disable-don't-delete mechanism (North Star v2 §6): deferred surfaces (hay
// marketplace, rancher-to-rancher messaging) get flagged OFF via Vercel env vars, code
// intact. A feature is enabled UNLESS its env var is explicitly "false" or "0" — unset
// means ON, so deploying this file with no env changes alters zero behavior.
//
// Flipping a flag is an env change + redeploy: set NEXT_PUBLIC_FEATURE_MARKETPLACE=false
// (or ..._MESSAGING=false) in Vercel, redeploy, and every consumer gates off. Reversal is
// the same change in the other direction. No code delta either way.
//
// NEXT_PUBLIC_* vars are inlined into client bundles at BUILD time, and only literal
// `process.env.NEXT_PUBLIC_X` property access survives that inlining — which is why each
// flag is read below as its own literal expression, never via dynamic indexing. Isomorphic
// on purpose (no 'server-only'): nav components, pages, and API routes all consult the
// same source of truth.

export type Feature = 'marketplace' | 'messaging'

// One literal process.env read per flag (see inlining note above).
const RAW_FLAG_ENV: Record<Feature, string | undefined> = {
  marketplace: process.env.NEXT_PUBLIC_FEATURE_MARKETPLACE,
  messaging: process.env.NEXT_PUBLIC_FEATURE_MESSAGING,
}

// Enabled unless explicitly opted out — only the exact strings "false" and "0" disable.
// Anything else (unset, "", "true", a typo) leaves the feature ON: the failure mode of a
// misspelled value is "nothing turned off", never "core surface accidentally dark".
export function flagEnabled(feature: Feature): boolean {
  const v = RAW_FLAG_ENV[feature]
  return v !== 'false' && v !== '0'
}

export function flagDisabled(feature: Feature): boolean {
  return !flagEnabled(feature)
}

import { loadEnv } from './env'

// Feature-flag awareness for the suite — mirrors lib/flags.ts semantics exactly:
// a feature is disabled ONLY when its env var is exactly 'false' or '0'; anything
// else (unset, '', 'true', a typo) means ON. Reads the same committed .env the
// preview build inlined (via loadEnv), so spec skips track the deployed flags.
// When a flag flips back on, these skips lift with no code change.
loadEnv()

const off = (v: string | undefined) => v === 'false' || v === '0'

export const marketplaceOff = off(process.env.NEXT_PUBLIC_FEATURE_MARKETPLACE)
export const messagingOff = off(process.env.NEXT_PUBLIC_FEATURE_MESSAGING)

export const MARKETPLACE_SKIP = 'marketplace flagged off (NEXT_PUBLIC_FEATURE_MARKETPLACE) — spec parked with the feature'
export const MESSAGING_SKIP = 'messaging and/or marketplace flagged off — spec parked with the feature'

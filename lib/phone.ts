// ─── What phone is this, and how is Dryline open on it? (Block 48) ───────────
// Three questions the install nudge, the in-app banner and the account page
// all ask. One place, so the answers never drift.

/** Known in-app browsers (Facebook, Messenger, Instagram and kin). Their cookie
 *  jars are isolated and often thrown away, and none of them can add a page to
 *  the home screen. iOS Safari and the Messages link sheet share Safari's UA
 *  and are NOT flagged — a false positive would nag a real Safari user. */
export const IN_APP_UA = /(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|GSA\/|Twitter|Snapchat|Pinterest|musical_ly|TikTok|; wv\))/i

export type PhonePlatform = 'ios' | 'android'

export function phonePlatform(ua: string): PhonePlatform | null {
  return /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : null
}

export function isInAppBrowser(ua: string): boolean {
  return IN_APP_UA.test(ua)
}

/** Opened from the home screen — iOS's own flag, or the display mode everyone else uses. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

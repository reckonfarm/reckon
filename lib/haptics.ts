// ─── Telling a thumb the tap landed (Block 22, ruling 2 as amended) ──────────
//
// The operator is watching cattle, not the screen. He has to know a tap landed
// without looking. Three honest states, and the app must know which one it is
// in rather than pretending:
//
//   'pulses'  the standard vibration API is there, so the confirmation is the
//             number the button says — one pulse for +1, four for +4. Android.
//
//   'tap'     no vibration API, but the phone can be made to give ONE system
//             haptic per press. On iPhone the only route is a switch control
//             being toggled; it cannot be counted out, so a +4 feels the same
//             as a +1. Better than nothing, and it is not pretended to be more.
//
//   'none'    the phone will not confirm by feel at all. Then the SCREEN has
//             to do it, and the tally screen does it in every case anyway —
//             see the pressed-button hold and the flashing total.
//
// PK'S AMENDMENT, verbatim: never ship a silent no-op that looks like it
// works. So confirmTap RETURNS what it actually did, the screen says which
// kind of confirmation this phone gives, and nothing here ever reports success
// it did not have.

export type HapticKind = 'pulses' | 'tap' | 'none'

/** One pulse: long enough to feel through a glove, short enough to count four. */
const ON_MS = 30
const GAP_MS = 70

let switchEl: HTMLInputElement | null = null
let kind: HapticKind | null = null

const canVibrate = (): boolean =>
  typeof navigator !== 'undefined' && typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === 'function'

/**
 * iPhone has no vibration API. It does have a system haptic on a switch
 * control, and toggling one in the DOM fires it. The element has to be really
 * in the page and really togglable — display:none kills it — so it is one
 * pixel, transparent, and untouchable by a finger.
 */
function iosSwitch(): HTMLInputElement | null {
  if (typeof document === 'undefined') return null
  if (switchEl?.isConnected) return switchEl
  try {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.setAttribute('switch', '')          // the attribute that makes it a switch — and haptic
    el.setAttribute('aria-hidden', 'true')
    el.tabIndex = -1
    el.style.cssText = 'position:fixed;left:-1px;bottom:-1px;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(el)
    switchEl = el
    return el
  } catch {
    return null
  }
}

const isApple = (): boolean =>
  typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent ?? '')

/**
 * What this phone can do, worked out once. Not a promise that it is switched
 * on at the system level — a phone with haptics turned off in Settings reports
 * 'pulses' and produces nothing, which is exactly why the screen confirms too.
 */
export function hapticKind(): HapticKind {
  if (kind !== null) return kind
  if (canVibrate()) kind = 'pulses'
  else if (isApple() && iosSwitch() !== null) kind = 'tap'
  else kind = 'none'
  return kind
}

/** Words for the one line the screen shows, so the operator knows what to expect. */
export const HAPTIC_WORDS: Record<HapticKind, string> = {
  pulses: 'Buzz: one for each head you tap',
  tap: 'Buzz: one for every tap — this phone cannot count them out',
  none: 'Buzz: not on this phone — watch the number flash instead',
}

/**
 * Confirm a tap of `n`. Returns what it actually managed, never what it hoped.
 * The caller confirms on screen regardless of this answer.
 */
export function confirmTap(n: number): HapticKind {
  const k = hapticKind()
  if (k === 'pulses') {
    const pattern: number[] = []
    for (let i = 0; i < n; i++) { pattern.push(ON_MS); if (i < n - 1) pattern.push(GAP_MS) }
    try {
      const ok = (navigator as Navigator & { vibrate: (p: number[]) => boolean }).vibrate(pattern)
      return ok === false ? 'none' : 'pulses'
    } catch {
      return 'none'
    }
  }
  if (k === 'tap') {
    const el = iosSwitch()
    if (!el) return 'none'
    try { el.checked = !el.checked; return 'tap' } catch { return 'none' }
  }
  return 'none'
}

/** Undo gets its own feel: one long buzz, so it is never mistaken for a count. */
export function confirmUndo(): HapticKind {
  const k = hapticKind()
  if (k === 'pulses') {
    try { (navigator as Navigator & { vibrate: (p: number[] | number) => boolean }).vibrate(140); return 'pulses' } catch { return 'none' }
  }
  return confirmTap(1)
}

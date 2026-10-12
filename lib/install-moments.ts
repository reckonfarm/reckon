// ─── When has Dryline earned the install ask? (Block 48, ruling R3) ──────────
// The nudge never shows on a first page load and never inside the installed
// app. It shows once something useful has happened on this phone:
//   signed in   — the 2nd save that reached the ranch, or a 2nd distinct day;
//   signed out  — a 2nd distinct day, or a 2nd county or market check.
// "Not now" (or closing the sheet) keeps it away for 14 days. Everything lives
// in ONE localStorage key, read and written inside try/catch: a phone that
// will not keep it simply never earns the ask, and nothing else breaks.
//
// The suite seeds this key to put a phone at the moment it wants to check.

export const INSTALL_KEY = 'dryline_install'
export const DISMISS_DAYS = 14

export type Moments = {
  /** Local calendar days Dryline was opened, newest last; only the last two are kept. */
  days: string[]
  /** Saves that reached the ranch while the nudge was mounted. */
  saves: number
  /** County and market checks while signed out. */
  checks: number
  /** ISO time of the last "Not now" or close; null when never. */
  dismissedAt: string | null
  /** ISO time the app told us it was installed; the ask never returns after. */
  installedAt: string | null
}

const EMPTY: Moments = { days: [], saves: 0, checks: 0, dismissedAt: null, installedAt: null }

export function readMoments(): Moments {
  try {
    const raw = localStorage.getItem(INSTALL_KEY)
    if (!raw) return { ...EMPTY }
    const m = JSON.parse(raw) as Partial<Moments>
    return {
      days: Array.isArray(m.days) ? m.days.filter(d => typeof d === 'string').slice(-2) : [],
      saves: typeof m.saves === 'number' ? m.saves : 0,
      checks: typeof m.checks === 'number' ? m.checks : 0,
      dismissedAt: typeof m.dismissedAt === 'string' ? m.dismissedAt : null,
      installedAt: typeof m.installedAt === 'string' ? m.installedAt : null,
    }
  } catch { return { ...EMPTY } }
}

function write(m: Moments): Moments {
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify(m)) } catch { /* a phone that keeps nothing never earns the ask */ }
  return m
}

/** Today in the phone's own calendar, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function noteDay(day = localDay()): Moments {
  const m = readMoments()
  if (m.days.includes(day)) return m
  return write({ ...m, days: [...m.days, day].slice(-2) })
}

export function noteSave(): Moments {
  const m = readMoments()
  return write({ ...m, saves: m.saves + 1 })
}

export function noteCheck(): Moments {
  const m = readMoments()
  return write({ ...m, checks: m.checks + 1 })
}

export function noteDismissed(now = new Date()): Moments {
  return write({ ...readMoments(), dismissedAt: now.toISOString() })
}

export function noteInstalled(now = new Date()): Moments {
  return write({ ...readMoments(), installedAt: now.toISOString() })
}

/** The phone has done enough for the ask. */
export function earned(m: Moments, signedIn: boolean): boolean {
  if (m.days.length >= 2) return true
  return signedIn ? m.saves >= 2 : m.checks >= 2
}

/** "Not now" within the last 14 days, or ever installed: no ask. */
export function quiet(m: Moments, now = new Date()): boolean {
  if (m.installedAt) return true
  if (!m.dismissedAt) return false
  const t = Date.parse(m.dismissedAt)
  return Number.isFinite(t) && now.getTime() - t < DISMISS_DAYS * 86_400_000
}

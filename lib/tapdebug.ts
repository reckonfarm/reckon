// TAPDEBUG — temporary on-device diagnostics for the iOS county-tap bug.
// Module-level ring buffer so the log survives client-side navigations (the
// very navigation we're trying to observe) and component re-renders. Remove
// this file and its callers once the bug is found.
type Listener = () => void

const buffer: string[] = []
const listeners = new Set<Listener>()
let t0 = 0

export function dbg(line: string) {
  let stamp = ''
  if (typeof performance !== 'undefined') {
    if (!t0) t0 = performance.now()
    stamp = `+${String(Math.round(performance.now() - t0)).padStart(5)}ms `
  }
  buffer.push(stamp + line)
  if (buffer.length > 300) buffer.shift()
  listeners.forEach(l => l())
}

export function getLog() {
  return buffer
}

export function clearLog() {
  buffer.length = 0
  t0 = 0
  listeners.forEach(l => l())
}

export function subscribe(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

// Unit self-check for lib/programDates.ts — the year-boundary rule and the
// urgency window, exercised with fixed "today" values (Playwright can't move
// the server clock). Exit 1 on any failure.
//   npx tsx scripts/check-program-dates.ts
import { deadlineFor, nextDeadline, isUrgent, daysUntil, PROGRAM_DATES } from '../lib/programDates'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const lfp = deadlineFor('LFP', 2026)
const prf = deadlineFor('PRF', 2027)
check('LFP 2026 losses due 2027-03-01', lfp?.deadline === '2027-03-01', lfp?.deadline)
check('PRF 2027 coverage closes 2026-12-01', prf?.deadline === '2026-12-01', prf?.deadline)
check('no LFP row is ever a December 1', !PROGRAM_DATES.some(d => d.program === 'LFP' && d.deadline.endsWith('-12-01')))

// Year boundary: on Jan 1, 2027 the 2026-loss deadline is still the answer.
const jan1 = nextDeadline('LFP', '2027-01-01')
check('2027-01-01 → LFP 2026 losses still 2027-03-01', jan1?.lossYear === 2026 && jan1.deadline === '2027-03-01')
check('deadlineFor never rolls forward (2027 row absent → null)', deadlineFor('LFP', 2027) === null)
check('after 2027-03-01 with no 2027 row → null, not an invented date', nextDeadline('LFP', '2027-03-02') === null)

// Urgency window: 60 days, inclusive; never before; never after the date.
check('2026-09-05 (177 days out) not urgent', lfp !== null && !isUrgent(lfp, '2026-09-05'), `${daysUntil('2027-03-01', '2026-09-05')} days`)
check('2026-12-31 (60 days out) urgent', lfp !== null && isUrgent(lfp, '2026-12-31'), `${daysUntil('2027-03-01', '2026-12-31')} days`)
check('2026-12-30 (61 days out) not urgent', lfp !== null && !isUrgent(lfp, '2026-12-30'))
check('deadline day urgent', lfp !== null && isUrgent(lfp, '2027-03-01'))
check('day after deadline not urgent', lfp !== null && !isUrgent(lfp, '2027-03-02'))
check('PRF 2026-09-05 (87 days out) not urgent', prf !== null && !isUrgent(prf, '2026-09-05'))
check('PRF 2026-10-02 (60 days out) urgent', prf !== null && isUrgent(prf, '2026-10-02'))

console.log(failed ? `\n${failed} FAILED` : '\nall PASS')
process.exit(failed ? 1 : 0)

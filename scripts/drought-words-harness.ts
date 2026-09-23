import {
  summarizeUsdm, droughtClassWords, droughtAlertLine, droughtAlertEmail, fmtValidDate,
} from '../lib/drought-words'
import { suiteIdentity } from './lib/suite-guard'

// ─── Block 16 (ruling 2) harness — the Thursday alert's words ─────────────────
//
// The alert a person reads is an EMAIL first and a ledger row second, and
// lib/email.ts is server-only, so nothing in the three suites can open it.
// The text therefore lives in lib/drought-words.ts, pure, and this holds it to
// the ruling: the U.S. Drought Monitor named as the source, the valid date the
// release carries, the class in plain words — and not one word about
// eligibility, tiers or payments, which are FSA's determination on their own
// screen. Self-checking, nonzero exit on any failure (the capture-harness and
// bale-detector convention).
//
//   npx tsx scripts/drought-words-harness.ts
//
// Reads nothing and writes nothing: pure functions and literals.

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// The USDM county statistics Dryline stores are statisticsType=1 — CUMULATIVE:
// d2 is the share of the county in D2 OR WORSE. A county 12% in D3 is also
// counted inside its 61% D2 figure, and the sentence has to say "or worse" or
// it reads as 61% + 12% of separate ground.
const GARFIELD = { d0: 100, d1: 88, d2: 61, d3: 12, d4: 0 }
const VALID = '2026-09-15'
const PROGRAM_WORDS = /\bLFP\b|\btier\b|\bpayment|\beligib|\bFSA\b|\bRMA\b|\benroll/i

// 1 — the reading becomes a class
{
  const s = summarizeUsdm(GARFIELD)
  check('the worst class with any coverage is the one named', s?.level === 3 && s?.pct === 12, `level ${s?.level} · ${s?.pct}%`)
  check('a county with no drought at all summarises to nothing, never to "D0 across 0%"',
    summarizeUsdm({ d0: 0, d1: 0, d2: 0, d3: 0, d4: 0 }) === null && summarizeUsdm({}) === null, 'null')
  const d0only = summarizeUsdm({ d0: 44 })
  check('abnormally dry is a class like any other, and names no class beneath it',
    droughtClassWords(d0only!) === 'Abnormally dry (D0) across 44% of the county', droughtClassWords(d0only!))
}

// 2 — the words, and the cumulative rule inside them
{
  const words = droughtClassWords(summarizeUsdm(GARFIELD)!)
  check('the class reads in plain words with its letter, and says "or worse" of the class beneath it',
    words === 'Extreme drought (D3) across 12% of the county, severe drought or worse across 61%', words)
  check('junior-high words only — no jargon, no percentages without a subject',
    !/percentile|areal|coverage|categor|index|anomal/i.test(words), words)
  // When the class beneath covers no more ground than this one, the second
  // clause would say nothing and is left off rather than printed as a repeat.
  const flat = droughtClassWords(summarizeUsdm({ d0: 12, d1: 12, d2: 12, d3: 12 })!)
  check('a class whose neighbour covers no more ground drops the second clause instead of repeating itself',
    flat === 'Extreme drought (D3) across 12% of the county', flat)
}

// 3 — the ledger row
{
  const p = { kind: 'lfp_drought_alert', county_name: 'Garfield County', state: 'MT', tier: 3, payments: 3, week_date: VALID, source: 'usdm', valid_date: VALID, usdm: summarizeUsdm(GARFIELD) }
  const line = droughtAlertLine(p as Record<string, unknown>)!
  check('the ledger row names the source, the county, the class and the valid date',
    /^U\.S\. Drought Monitor: Garfield County — Extreme drought \(D3\) across 12% of the county, severe drought or worse across 61% · valid Sep 15, 2026$/.test(line), line)
  check('the ledger row says nothing about eligibility, tiers or payments — the trigger is data, not words',
    !PROGRAM_WORDS.test(line), line)
  // An alert written before this block has no class on it. It says so.
  const old = droughtAlertLine({ kind: 'lfp_drought_alert', county_name: 'Garfield County', tier: 2, payments: 2, week_date: VALID } as Record<string, unknown>)!
  check('an alert written before the class was kept says so rather than guessing one',
    /the drought class was not kept on this alert/.test(old) && /valid Sep 15, 2026/.test(old) && !PROGRAM_WORDS.test(old), old)
  check('a payload that cannot even name a county is left out of the record, never shown as a bare word',
    droughtAlertLine({ kind: 'lfp_drought_alert' } as Record<string, unknown>) === null
    && droughtAlertLine({ kind: 'something_else', county_name: 'Garfield County' } as Record<string, unknown>) === null, 'null')
}

// 4 — the email
{
  const e = droughtAlertEmail({ countyName: 'Garfield County', state: 'MT', fips: '30033', validDate: VALID, usdm: summarizeUsdm(GARFIELD) })
  check('the subject names the county, the class and the U.S. Drought Monitor, and carries the valid date',
    e.subject === 'Garfield County, MT: extreme drought (D3) — U.S. Drought Monitor, valid Sep 15, 2026', e.subject)
  check('the body opens on the source and the valid date, then the class in one sentence',
    e.body.startsWith('U.S. Drought Monitor — Garfield County, MT\nValid Sep 15, 2026\n\nExtreme drought (D3) across 12% of the county, severe drought or worse across 61%.\n'),
    e.body.split('\n').slice(0, 4).join(' / '))
  check('the whole email says nothing about eligibility, tiers or payments — except naming FSA as the one who determines',
    !PROGRAM_WORDS.test(e.subject) && !PROGRAM_WORDS.test(e.body.replace("Any program determination is FSA's to make.", '')),
    (e.body.replace("Any program determination is FSA's to make.", '').match(PROGRAM_WORDS) ?? ['none'])[0])
  check('the email credits the National Drought Mitigation Center and leaves the determination to FSA',
    /Source: U\.S\. Drought Monitor, National Drought Mitigation Center\. Any program determination is FSA's to make\./.test(e.body), 'source line present')
  check('the email says how to stop getting it',
    /added this county to your Dryline watchlist/.test(e.body) && /Manage your counties: https:\/\/dryline\.farm\/watchlist/.test(e.body), 'unsubscribe path present')
  const none = droughtAlertEmail({ countyName: 'Garfield County', state: 'MT', fips: '30033', validDate: VALID, usdm: null })
  check('an alert with no reading on file sends a weaker, honest sentence rather than an invented class',
    /The drought class for this release was not on file when this was sent\./.test(none.body) && /drought update/.test(none.subject), none.subject)
}

// 5 — the date the release carries
{
  check('the valid date reads as a person writes one, and an unreadable date is passed through rather than invented',
    fmtValidDate(VALID) === 'Sep 15, 2026' && fmtValidDate('not-a-date') === 'not-a-date', fmtValidDate(VALID))
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}  —  ${suiteIdentity()}`)
process.exit(failures ? 1 : 0)

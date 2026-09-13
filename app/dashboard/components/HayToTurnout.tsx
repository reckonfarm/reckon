import { fmtDay, plural } from '@/lib/jobs/format'
import { LATE_DAYS, WORST_WINDOW_DAYS, type HayPlan, type PlanWithheld, type Scenario } from '@/lib/hay/plan'
import type { TurnoutState } from '@/lib/hay/turnout'
import TurnoutDate from './TurnoutDate'

// ─── Hay to turnout (Block 9) ─────────────────────────────────────────────────
//
// The runway already had a length. This gives it an end: the day the cattle go
// back to grass, and whether the stack reaches it.
//
// PK's rulings on the copy, not just the arithmetic:
//
//  * TWO DATES, NOT A WORST RATE. "Two dates is a question I can act on; a
//    worst rate is a number I'd argue with." So the pair is turnout as he
//    expects it and turnout three weeks late — one rate, two targets, one line
//    each (the 8B.3 rule: one line per row).
//
//  * THE RATE IS HIS OWN AND SAYS SO. Planned at his heaviest sustained
//    fourteen days, named with the dates it came from, so the number can be
//    checked against the ledger rather than believed.
//
//  * NOT ENOUGH WINTER YET IS SAID PLAINLY, NOT SUBSTITUTED. A ledger shorter
//    than fourteen days has no worst fourteen days in it. The line then says
//    what it actually measured and refuses the words "worst case".
//
//  * THE ANSWER APPEARS BEFORE THE RUN-OUT DATE'S GATE. Under seven feeding
//    days it still answers, and says how thin it is: "5 days of feeding so far
//    — this will sharpen." In November the decision is whether to buy hay, and
//    a blank screen is not the safer answer.
//
// Every figure printed is the figure the arithmetic used (the 6C rule): needed
// − on hand is the short number, exactly, on the back of an envelope.

const ranchDay = (key: string) => fmtDay(`${key}T12:00:00-06:00`)
const shortDay = (key: string) => new Date(`${key}T12:00:00-06:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtRate = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1))

const HEADING = 'Hay to turnout'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-forest-green/10 pt-4" data-audit="hay-to-turnout">
      <p className="font-dm-sans text-[17px] font-semibold text-ink">{HEADING}</p>
      {children}
    </div>
  )
}

function line(s: Scenario, lead: string, onHand: number): string {
  const head = `${lead} · ${plural(s.days, 'day')} · ${s.needed.toLocaleString()} needed · ${onHand.toLocaleString()} on hand`
  return s.reaches
    ? `${head} — reaches it with ${plural(s.spare, 'bale')} to spare.`
    : `${head} — ${plural(s.short, 'bale')} short, and you would run out around ${ranchDay(s.runShort!)}.`
}

export default function HayToTurnout({ plan, turnout }: {
  plan: HayPlan | { withheld: PlanWithheld }
  turnout: TurnoutState & { suggested: string | null }
}) {
  const control = (
    <TurnoutDate
      current={turnout.upcoming?.date ?? null}
      suggested={turnout.suggested}
      lastYear={turnout.last ? ranchDay(turnout.last.date) : null}
      prompt="Set turnout date"
    />
  )

  if (plan.withheld) {
    // Each refusal names itself and says what would answer it — the same rule
    // the run-out projection follows, never a blank where a number belongs.
    const said: Record<PlanWithheld, string> = {
      no_turnout: 'Set the day the cattle go back to grass and this will say whether the hay reaches it.',
      turnout_past: turnout.last
        ? `Turnout was ${ranchDay(turnout.last.date)}. Set this year’s and this will answer again.`
        : 'That turnout date has passed. Set the next one and this will answer again.',
      no_baseline: 'Count your bales and this will say whether they reach turnout — on hand has to stand on a count.',
      no_feeding: 'Nothing fed yet, so there is no rate of your own to plan at. This answers once you have fed a few days.',
    }
    return (
      <Frame>
        <p className="mt-1 font-dm-sans text-[16px] text-ink" data-audit="turnout-withheld" data-reason={plan.withheld}>
          {said[plan.withheld]}
        </p>
        {control}
      </Frame>
    )
  }

  const { rate, expected, late, onHand, feedDays, thin } = plan
  const rateLine = rate.full
    ? `Planned at ${fmtRate(rate.balesPerDay)} bales/day — your heaviest ${WORST_WINDOW_DAYS} days so far, ${shortDay(rate.from)}–${shortDay(rate.to)}.`
    : `Planned at ${fmtRate(rate.balesPerDay)} bales/day — everything you have fed, over ${plural(rate.days, 'day')}. That is not yet a full ${WORST_WINDOW_DAYS} days, so it is not a worst case.`

  return (
    <Frame>
      <p className="mt-1 font-dm-sans text-[16px] text-ink" data-audit="turnout-rate" data-full={rate.full ? 'true' : 'false'}>
        {rateLine}
      </p>
      <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="turnout-expected" data-reaches={expected.reaches ? 'true' : 'false'}>
        {line(expected, `Turnout ${ranchDay(expected.date)}`, onHand)}
      </p>
      <p className="mt-1.5 font-dm-sans text-[16px] text-ink" data-audit="turnout-late" data-reaches={late.reaches ? 'true' : 'false'}>
        {line(late, `Three weeks late (${ranchDay(late.date)})`, onHand)}
      </p>
      {thin && (
        <p className="mt-2 font-dm-sans text-[14px] text-ink" data-audit="turnout-thin">
          {plural(feedDays, 'day')} of feeding so far — this will sharpen.
        </p>
      )}
      {control}
    </Frame>
  )
}

export { LATE_DAYS }

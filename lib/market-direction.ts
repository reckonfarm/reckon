// ─── The arrow/color rule for every market delta in the app ────────────────────
//
// THE RULE (named 2026-08-09, the day corn ▲ rendered green): the ARROW shows
// which way the number moved; the COLOR shows whether that move is good or
// bad FOR A COW-CALF OPERATOR. Two independent channels — direction is a
// fact, color is a judgment, and the judgment is always from the seat of
// someone who sells calves and buys feed.
//
// Where the two agree, nothing looks different: cattle prices, herd value —
// up is good, ▲ green. Where they diverge the color must win the meaning:
//   * Corn PRICE up = feed cost rising = feedlots bid less for calves → ▲ red.
//   * Feed-region drought footprint up = drier feeding area → ▲ red.
//   * Heifers on feed up = herd still liquidating, future supply loose → ▲ red.
// (Corn CONDITION is the mirror: a better crop = cheaper feed → ▲ green.)
//
// Every delta chip renders through this helper so a new chip can't quietly
// re-invent raw-number coloring — that's the bug this rule replaced.

export interface MarketDelta {
  arrow: '▲' | '▼'
  cls: 'text-up' | 'text-down'
}

export function marketDelta(wentUp: boolean, upIsGoodForCowCalf: boolean): MarketDelta {
  return {
    arrow: wentUp ? '▲' : '▼',
    cls: wentUp === upIsGoodForCowCalf ? 'text-up' : 'text-down',
  }
}

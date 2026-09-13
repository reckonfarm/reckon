// ─── Group actions — the vocabulary (Block 10) ────────────────────────────────
// Isomorphic on purpose (no 'server-only'): the chute screen, the Activity
// record and the route all name these, and a client component must be able to
// import the labels without dragging the server module in behind them. Same
// split as lib/places/kinds.ts.
//
// A group action is a dated working that produces NAMED RESULT GROUPS with
// their own counts, reconciling against a count taken at the chute. Preg check
// is the first one with a screen; the others are the same primitive and are
// listed here so the database's allowed set and the app's have one source.

export const GROUP_ACTIONS = ['preg_check', 'sort', 'wean', 'ship'] as const
export type GroupAction = (typeof GROUP_ACTIONS)[number]

export const isGroupAction = (v: unknown): v is GroupAction =>
  typeof v === 'string' && (GROUP_ACTIONS as readonly string[]).includes(v)

export const GROUP_ACTION_LABELS: Record<GroupAction, string> = {
  preg_check: 'Preg check',
  sort: 'Sorted',
  wean: 'Weaned',
  ship: 'Shipped',
}

export const GROUP_ACTION_TYPE = 'group_action'
export const MAX_HEAD = 20_000
export const MAX_GROUP_NAME = 40

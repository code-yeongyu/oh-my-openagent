// The X1a proof scenario (#14962; design docs/reference/omo-sdk-first-party-design.md sections 7.7 and 9), as data.
// One table, read by the three drivers (drivers/sdk.ts, drivers/tools.ts, drivers/cli.ts), so the three runs are the
// same scenario by construction. A step names the SDK root operation (section 6.2) and its input in the root's
// vocabulary; each driver maps the operation onto its own surface, or declares it not available today with the slice
// that adds it. `expect` is what device B shows afterwards, read from B's engine by the world, never from the surface.
// B's model is the thread-tools QA kit's fake model: it answers `QA-ACK <tokens>` to a message carrying QA-TOKEN-*
// markers, and keeps a turn carrying `QA:HOLD <tag>` streaming until the world releases that tag.

/** The three surfaces, each run on its own: the SDK script, the thread tools in a session, the CLI. */
export type Surface = "sdk" | "tools" | "cli"
export const SURFACES: readonly Surface[] = ["sdk", "tools", "cli"]

/** The operations the scenario uses, named as the SDK root names them (design 6.2). */
export type Op = "create" | "send" | "read" | "interrupt" | "setModel" | "setReasoning" | "close"

/** What device B's engine must show after the step, read through B's own socket (world/observe.ts). */
export type Expect =
  | { readonly kind: "exchange"; readonly token: string; readonly opens?: true }
  | { readonly kind: "answered"; readonly token: string }
  | { readonly kind: "holding"; readonly tag: string }
  | { readonly kind: "steered"; readonly tag: string; readonly token: string }
  | { readonly kind: "interrupted"; readonly tag: string }
  | { readonly kind: "model"; readonly provider: string; readonly id: string; readonly thinking: string }
  | { readonly kind: "parked"; readonly provider: string; readonly id: string; readonly thinking: string }
  | { readonly kind: "applied"; readonly token: string; readonly provider: string; readonly id: string }
  | { readonly kind: "level"; readonly provider: string; readonly id: string; readonly thinking: string }
  | { readonly kind: "closed" }

export type Step = {
  readonly id: string
  readonly op: Op
  /** The root input; `{{thread}}`, `{{deviceB}}` and `{{run}}` are filled per run (the thread from its own open). */
  readonly input: Readonly<Record<string, string>>
  /** A held turn the world releases after the surface answered and before B is observed. */
  readonly release?: string
  readonly expect: Expect
  /**
   * The surfaces whose principal the contract refuses this input to, and the code it refuses with: on them the step
   * passes on that refusal (design ruling of 2026-11-25: a steer without expected_turn_id is refused to a session
   * principal, the tools, and steers the running turn for a script or a person, the SDK and the CLI).
   */
  readonly refusedTo?: { readonly surfaces: readonly Surface[]; readonly code: string }
  /** World state the step needs before the surface is called: B's thread filled so a switch fits only after compaction. */
  readonly before?: "fill-context"
  /** The design row and the slice that builds its SDK call (design sections 6.2 and 8). */
  readonly owner: { readonly row: string; readonly slice: string }
}

/** The model the set-model step switches to on B, with a thinking suffix (#14939); world/world.ts lists it on B. */
export const SWITCH_TO = { provider: "mock", id: "mock-think", thinking: "high" } as const

/**
 * The switch that parks (#14939): B's catalog lists a ladder of models (one per window size); after filling the thread
 * the world reads B's switch requirement and names the largest window below it, which fits only after a compaction.
 */
export const PARK_TO = {
  provider: "mock",
  thinking: "high",
  windows: { from: 40_000, to: 160_000, step: 2_000 },
} as const
export const parkModelId = (window: number): string => `mock-park-${window}`
/** A model too small for any thread: a switch to it is refused with the thread's switch requirement, and changes nothing. */
export const METER_MODEL = "mock-meter"
/** The ladder model a filled thread with this switch requirement parks a switch to: the largest window below it. */
export const parkWindowFor = (requirement: number): number | undefined => {
  const { from, to, step } = PARK_TO.windows
  const below = Math.floor((Math.min(requirement - 1_000, to) - from) / step)
  return below < 0 ? undefined : from + below * step
}

export const ackOf = (token: string): string => `QA-ACK ${token}`

const OPEN = "QA-TOKEN-x1a-open-{{run}}"
const FOLLOW = "QA-TOKEN-x1a-follow-{{run}}"
const STEER = "QA-TOKEN-x1a-steer-{{run}}"
const STEER_UNNAMED = "QA-TOKEN-x1a-steer-unnamed-{{run}}"
const AFTER = "QA-TOKEN-x1a-after-compaction-{{run}}"

export const SCENARIO: readonly Step[] = [
  {
    id: "open",
    op: "create",
    input: { device: "{{deviceB}}", prompt: `x1a open ${OPEN}` },
    expect: { kind: "exchange", token: OPEN, opens: true },
    owner: { row: "threads.create", slice: "T1a (locator), T1b (inputs)" },
  },
  {
    id: "send",
    op: "send",
    input: { thread: "{{thread}}", message: `x1a follow-up ${FOLLOW}`, delivery: "follow_up" },
    expect: { kind: "exchange", token: FOLLOW },
    owner: { row: "threads.send", slice: "T1a (locator), T1b (inputs)" },
  },
  {
    id: "read",
    op: "read",
    input: { thread: "{{thread}}" },
    expect: { kind: "answered", token: FOLLOW },
    owner: { row: "threads.read", slice: "T1b" },
  },
  {
    id: "send-long",
    op: "send",
    input: { thread: "{{thread}}", message: "x1a long QA:HOLD {{run}}-steer", delivery: "follow_up" },
    expect: { kind: "holding", tag: "{{run}}-steer" },
    owner: { row: "threads.send", slice: "T1a (locator), T1b (inputs)" },
  },
  {
    id: "steer",
    op: "send",
    input: { thread: "{{thread}}", message: `x1a steer ${STEER}`, delivery: "steer", expected_turn_id: "{{turn}}" },
    release: "{{run}}-steer",
    expect: { kind: "steered", tag: "{{run}}-steer", token: STEER },
    owner: { row: "threads.send (delivery steer)", slice: "T1a (locator), T1b (inputs)" },
  },
  {
    id: "send-long-3",
    op: "send",
    input: { thread: "{{thread}}", message: "x1a long three QA:HOLD {{run}}-steer-unnamed", delivery: "follow_up" },
    expect: { kind: "holding", tag: "{{run}}-steer-unnamed" },
    owner: { row: "threads.send", slice: "T1a (locator), T1b (inputs)" },
  },
  {
    id: "steer-unnamed",
    op: "send",
    input: { thread: "{{thread}}", message: `x1a steer unnamed ${STEER_UNNAMED}`, delivery: "steer" },
    release: "{{run}}-steer-unnamed",
    expect: { kind: "steered", tag: "{{run}}-steer-unnamed", token: STEER_UNNAMED },
    refusedTo: { surfaces: ["tools"], code: "invalid_arguments" },
    owner: { row: "threads.send (delivery steer, no expected_turn_id)", slice: "T1a (core send rule)" },
  },
  {
    id: "send-long-2",
    op: "send",
    input: { thread: "{{thread}}", message: "x1a long two QA:HOLD {{run}}-interrupt", delivery: "follow_up" },
    expect: { kind: "holding", tag: "{{run}}-interrupt" },
    owner: { row: "threads.send", slice: "T1a (locator), T1b (inputs)" },
  },
  {
    id: "interrupt",
    op: "interrupt",
    input: { thread: "{{thread}}" },
    expect: { kind: "interrupted", tag: "{{run}}-interrupt" },
    owner: { row: "threads.interrupt", slice: "T1b" },
  },
  {
    id: "set-model",
    op: "setModel",
    input: { thread: "{{thread}}", model: `${SWITCH_TO.provider}/${SWITCH_TO.id}:${SWITCH_TO.thinking}` },
    expect: { kind: "model", ...SWITCH_TO },
    owner: { row: "threads.setModel (#14939)", slice: "T1b-m (#14939, folded into T1b)" },
  },
  {
    id: "set-model-parked",
    op: "setModel",
    input: { thread: "{{thread}}", model: `${PARK_TO.provider}/{{park}}:${PARK_TO.thinking}` },
    before: "fill-context",
    expect: { kind: "parked", provider: PARK_TO.provider, id: "{{park}}", thinking: PARK_TO.thinking },
    owner: { row: "threads.setModel, applies after compaction (#14939)", slice: "T1b-m (#14939, folded into T1b)" },
  },
  {
    id: "after-compaction",
    op: "send",
    input: { thread: "{{thread}}", message: `x1a after compaction ${AFTER}`, delivery: "follow_up" },
    expect: { kind: "applied", token: AFTER, provider: PARK_TO.provider, id: "{{park}}" },
    owner: { row: "threads.setModel, applies after compaction (#14939)", slice: "T1b-m (#14939, folded into T1b)" },
  },
  {
    // The level the held switch could not carry (design ruling of 2026-11-25): the caller sets it once the switch has
    // landed, as the parked answer tells it (thinking_level_sent false). When the pinned engine carries the level with the
    // held switch (senpi#7468), this step goes and after-compaction expects the level directly.
    id: "set-level",
    op: "setReasoning",
    input: { thread: "{{thread}}", level: PARK_TO.thinking },
    expect: { kind: "level", provider: PARK_TO.provider, id: "{{park}}", thinking: PARK_TO.thinking },
    owner: { row: "threads.setReasoning (#14939, engine senpi#7468)", slice: "T1b-m (#14939, folded into T1b)" },
  },
  {
    id: "close",
    op: "close",
    input: { thread: "{{thread}}" },
    expect: { kind: "closed" },
    owner: { row: "threads.close", slice: "T1b" },
  },
]

/** Where a cell's finding belongs to someone other than its step's slice (the design lane's routing), by `<surface>:<step id>`. */
export const OWNERS: Readonly<Record<string, string>> = {
  "tools:steer": "the engine (senpi#7478: a started delivery answers the turn before the one it starts)",
  "tools:interrupt": "the engine (senpi#7478: a started delivery answers the turn before the one it starts)",
  "cli:close": "T1b (PR 15000)",
}

/** A note shown beside a cell whatever its outcome, for a cell whose outcome is known to vary between runs. */
export const NOTES: Readonly<Record<string, string>> = {
  "tools:interrupt":
    "varies between runs: the engine defect of #15013 (senpi#7478) names the turn before the started one, so this interrupt hits the held turn only when the turn ids line up; the cell is not stable until the pinned engine carries that fix",
}

/** The issue filed for a cell's finding, by `<surface>:<step id>`, shown beside the cell while it fails. */
export const ISSUES: Readonly<Record<string, string>> = {
  "sdk:open": "#15006",
  "tools:steer": "#15013",
  "tools:interrupt": "#15013",
  "sdk:set-model-parked": "#14939",
  "tools:set-model-parked": "#14939",
  "cli:set-model-parked": "#14939",
  "sdk:after-compaction": "#15026, senpi#7482",
  "tools:after-compaction": "#15026, senpi#7482",
  "cli:after-compaction": "#15026, senpi#7482",
  "cli:close": "#14992",
}

export const OPS: readonly Op[] = ["create", "send", "read", "interrupt", "setModel", "setReasoning", "close"]

/** How a driver answers an operation today: the call it makes, or why the surface cannot make it yet. */
export type Mapping =
  | { readonly kind: "call"; readonly how: string }
  | { readonly kind: "unavailable"; readonly slice: string }
  /** A call that needs the account sign-in: in a world without an account it is not reached, nor are the cells behind it. */
  | { readonly kind: "needs_account"; readonly how: string }

/** A step's input with the run's values filled in. */
export const fill = (text: string, values: Readonly<Record<string, string>>): string =>
  text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole)

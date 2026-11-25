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
export type Op = "create" | "send" | "read" | "interrupt" | "setModel" | "close"

/** What device B's engine must show after the step, read through B's own socket (world/observe.ts). */
export type Expect =
  | { readonly kind: "exchange"; readonly token: string; readonly opens?: true }
  | { readonly kind: "answered"; readonly token: string }
  | { readonly kind: "holding"; readonly tag: string }
  | { readonly kind: "steered"; readonly tag: string; readonly token: string }
  | { readonly kind: "interrupted"; readonly tag: string }
  | { readonly kind: "model"; readonly provider: string; readonly id: string; readonly thinking: string }
  | { readonly kind: "parked"; readonly provider: string; readonly id: string; readonly thinking: string }
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

/** The model whose window B's filled thread fits only after a compaction: a switch to it parks (#14939). */
export const PARK_TO = { provider: "mock", id: "mock-park", thinking: "high", contextWindow: 80_000 } as const

export const ackOf = (token: string): string => `QA-ACK ${token}`

const OPEN = "QA-TOKEN-x1a-open-{{run}}"
const FOLLOW = "QA-TOKEN-x1a-follow-{{run}}"
const STEER = "QA-TOKEN-x1a-steer-{{run}}"
const STEER_UNNAMED = "QA-TOKEN-x1a-steer-unnamed-{{run}}"

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
    input: { thread: "{{thread}}", model: `${PARK_TO.provider}/${PARK_TO.id}:${PARK_TO.thinking}` },
    before: "fill-context",
    expect: { kind: "parked", provider: PARK_TO.provider, id: PARK_TO.id, thinking: PARK_TO.thinking },
    owner: { row: "threads.setModel, applies after compaction (#14939)", slice: "T1b-m (#14939, folded into T1b)" },
  },
  {
    id: "close",
    op: "close",
    input: { thread: "{{thread}}" },
    expect: { kind: "closed" },
    owner: { row: "threads.close", slice: "T1b" },
  },
]

/** The issue filed for a cell's finding, by `<surface>:<step id>`, shown beside the cell while it fails. */
export const ISSUES: Readonly<Record<string, string>> = {
  "sdk:open": "#15006",
  "tools:steer": "#15007",
  "sdk:steer": "#15007",
}

export const OPS: readonly Op[] = ["create", "send", "read", "interrupt", "setModel", "close"]

/** How a driver answers an operation today: the call it makes, or why the surface cannot make it yet. */
export type Mapping =
  | { readonly kind: "call"; readonly how: string }
  | { readonly kind: "unavailable"; readonly slice: string }
  /** A call that needs the account sign-in, which the world does not carry yet: not run, nor the cells behind it. */
  | { readonly kind: "needs_account"; readonly how: string }

/** A step's input with the run's values filled in. */
export const fill = (text: string, values: Readonly<Record<string, string>>): string =>
  text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole)

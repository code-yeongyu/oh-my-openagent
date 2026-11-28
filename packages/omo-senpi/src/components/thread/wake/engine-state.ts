/**
 * What the carrier reads from `get_state` and the open reply (#13037 A3.2.1-A3.2.8, close probe K1-K10). Finished means
 * nothing runs and nothing waits but a wait a delivery ends; a person's wait is a pending dialog or a human wait a person
 * must answer (`PERSON_WAIT`); held is a hold or a paused session. Background work and children are work: the carrier
 * never releases then.
 */
export type EngineView = {
  readonly held: boolean
  readonly holdKinds: readonly string[]
  readonly waitingForPerson: boolean
  /** The human wait kinds that make it a person's wait (`pendingDialog` for an open dialog with no such kind). */
  readonly personWaitKinds: readonly string[]
  readonly working: boolean
  readonly finished: boolean
  readonly humanInputRevision: number | null
}

/**
 * Every human wait kind the engine emits (senpi `session-lifecycle-types.ts` `HumanWait`, a closed union), and whether it
 * keeps a queued delivery from the session (#15279). A person's question or approval, and a run a person interrupted
 * (the engine holds admissions under it and writes a pause notice; a guarded resume lifts it), wait for that person. The
 * engine's own goal waits and a stalled turn wait for any input, and a delivery is one. A kind not listed blocks.
 */
const PERSON_WAIT: Readonly<Record<string, boolean>> = {
  question: true,
  approval: true,
  interrupted_run: true,
  goal_paused: false,
  goal_blocked: false,
  stalled: false,
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function readEngineState(state: unknown): EngineView {
  const data = record(state)
  const lifecycle = record(data.lifecycle)
  const waitingOn = record(lifecycle.waitingOn)
  const holds = list(data.holds).map((hold) => String(record(hold).kind ?? "unknown"))
  const human = list(waitingOn.human).map((wait) => String(record(wait).kind ?? "unknown"))
  const personKinds = human.filter((kind) => PERSON_WAIT[kind] ?? true)
  const dialog = list(data.pendingDialogs).length > 0
  const personWait = personKinds.length > 0 || dialog
  const held = holds.length > 0 || data.paused === true
  const working =
    data.isStreaming === true ||
    lifecycle.state === "running" ||
    lifecycle.state === "waiting_background" ||
    lifecycle.state === "waiting_children" ||
    list(waitingOn.background).length > 0 ||
    Number(waitingOn.children ?? 0) > 0
  const revision = lifecycle.humanInputRevision
  return {
    held,
    holdKinds: holds,
    waitingForPerson: personWait,
    personWaitKinds: personKinds.length > 0 ? personKinds : dialog ? ["pendingDialog"] : [],
    working,
    finished: !held && !personWait && !working,
    humanInputRevision: typeof revision === "number" ? revision : null,
  }
}

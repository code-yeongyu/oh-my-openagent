/**
 * What the carrier reads from `get_state` and the open reply (#13037 A3.2.1-A3.2.8, close probe K1-K10). Finished means
 * nothing runs and nothing waits but a stalled turn; a person's wait is a pending dialog or a human wait that is not
 * stalled; held is a hold or a paused session. Background work and children are work: the carrier never releases then.
 */
export type EngineView = {
  readonly held: boolean
  readonly holdKinds: readonly string[]
  readonly waitingForPerson: boolean
  readonly working: boolean
  readonly finished: boolean
  readonly humanInputRevision: number | null
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
  const personWait = human.some((kind) => kind !== "stalled") || list(data.pendingDialogs).length > 0
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
    working,
    finished: !held && !personWait && !working,
    humanInputRevision: typeof revision === "number" ? revision : null,
  }
}

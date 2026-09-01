import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventTelemetryProperties, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"
import type { TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { TaskTerminalEdge, TaskTerminalObservers } from "../task/terminal-observers"
import {
  projectDelegationCompleted,
  type DelegationStartReason,
  type DelegationSteerCounts,
} from "./delegation-projection"
import type { OmoNativeEventName } from "./product-identity"

const SOURCE = "omo-native-delegation"
const MAX_EVENT_LOG_BYTES = 4 * 1024 * 1024

export type OmoNativeDelegationOptions = {
  readonly captureEvent: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly hashSessionId: (rawId: string) => string
  readonly observers: TaskTerminalObservers
  readonly stateDir: string
}

/**
 * Capture one `delegation_completed` row per nonterminal -> terminal edge of a delegated task.
 *
 * Three invariants make this safe to hang off a store write:
 * 1. it is fire-and-forget - the whole body is caught, failures reach `diagnostics` only, and no
 *    store transition ever awaits network I/O;
 * 2. it dedupes on `(task_seq, run_epoch)`, so a repeated terminal write (a `lost -> lost` reason
 *    update, a residency evict on an already terminal record, a terminal reattach) emits nothing;
 * 3. it hashes `record.parent_session_id` - the session that OWNS the task - and never touches the
 *    live session hash, so a resumed old task cannot redirect the current session's events.
 *
 * Returns the unsubscribe. Senpi re-registers components on session switch/resume, so failing to
 * detach would leave one observer per past registration writing into dead clients.
 */
export function createOmoNativeDelegationCapture(options: OmoNativeDelegationOptions): () => void {
  const emitted = new Set<string>()
  const priorStatus = new Map<number, TaskStatus>()
  const unsubscribe = options.observers.subscribe((edge) => {
    try {
      capture(options, edge, emitted, priorStatus)
    } catch (error) {
      options.diagnostics?.({
        event: "telemetry_capture_failed",
        source: SOURCE,
        error,
        errorKind: error instanceof Error ? "error" : "non_error",
      })
    }
  })
  return () => {
    unsubscribe()
    emitted.clear()
    priorStatus.clear()
  }
}

function capture(
  options: OmoNativeDelegationOptions,
  edge: TaskTerminalEdge,
  emitted: Set<string>,
  priorStatus: Map<number, TaskStatus>,
): void {
  const { record } = edge
  const key = `${record.task_seq ?? -1}:${record.notification.run_epoch}`
  if (emitted.has(key)) return
  emitted.add(key)

  const events = readTaskEvents(options.stateDir, record.task_id)
  options.captureEvent("delegation_completed", projectDelegationCompleted({
    edge,
    sessionHash: options.hashSessionId(record.parent_session_id),
    startReason: startReasonOf(record, events, priorStatus),
    steerCounts: countSteers(events, record.notification.run_epoch),
  }))
  if (record.task_seq !== undefined) priorStatus.set(record.task_seq, record.status)
}

/**
 * Why this run started. A raw `revived` event is not a re-query: the prior run's terminal status is
 * what separates "the user asked again" from "the user recovered a crash", so the reason is composed
 * from the epoch's own revive marker plus the previous terminal status this process observed.
 */
function startReasonOf(
  record: TaskRecord,
  events: readonly PersistedEventLine[],
  priorStatus: Map<number, TaskStatus>,
): DelegationStartReason {
  const epoch = record.notification.run_epoch
  if (epoch === 0) return record.owner?.kind === "dag" ? "dag_retry" : "initial_spawn"
  const revived = events.some((event) => event.type === "revived" && event.runEpoch === epoch)
  if (!revived) return record.owner?.kind === "dag" ? "dag_retry" : "unknown"
  const previous = record.task_seq === undefined ? undefined : priorStatus.get(record.task_seq)
  switch (previous) {
    case "completed":
      return "revive_after_completed"
    case "error":
      return "revive_after_error"
    case "cancelled":
      return "revive_after_cancelled"
    case "interrupted":
      return "revive_after_interrupted"
    case "lost":
      return "revive_after_lost"
    case "pending":
    case "running":
    case undefined:
      // The prior terminal happened in a process that is gone (or before this subscription): the
      // epoch proves a resume, but its prior outcome is not knowable here and is never guessed.
      return "session_resume"
    default:
      return assertNever(previous)
  }
}

/**
 * Count parent follow-ups for THIS run epoch. Only accepted, persisted steering events count: a
 * rejected control call never reaches the log, a queued prelaunch message is reported separately
 * because it cannot be a revision of output that does not exist yet, and a previous epoch's sends
 * belong to the row that already reported them.
 */
function countSteers(events: readonly PersistedEventLine[], runEpoch: number): DelegationSteerCounts {
  let running = 0
  let queued = 0
  for (const event of events) {
    if (event.runEpoch !== runEpoch) continue
    if (event.type === "steered") running += 1
    if (event.type === "steer_queued") queued += 1
  }
  return { running, queued }
}

type PersistedEventLine = {
  readonly type: string
  readonly runEpoch: number | undefined
}

/**
 * Read the task's own event log for event TYPES and run epochs only. Payload bodies (messages,
 * responses, tool arguments) are never inspected, and the counting happens synchronously at the
 * terminal edge because TTL expunge deletes this file with the record.
 */
function readTaskEvents(stateDir: string, taskId: string): readonly PersistedEventLine[] {
  const text = readEventLogText(join(stateDir, "logs", `${taskId}.jsonl`))
  if (text === undefined) return []
  const lines: PersistedEventLine[] = []
  for (const line of text.split("\n")) {
    if (line.length === 0) continue
    const parsed = parseEventLine(line)
    if (parsed !== undefined) lines.push(parsed)
  }
  return lines
}

// A missing, unreadable or expunged log is not an error: the counters are honestly zero.
function readEventLogText(path: string): string | undefined {
  try {
    const text = readFileSync(path, "utf8")
    return text.length > MAX_EVENT_LOG_BYTES ? text.slice(-MAX_EVENT_LOG_BYTES) : text
  } catch {
    return undefined
  }
}

function parseEventLine(line: string): PersistedEventLine | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined
    const payload = parsed.payload
    const runEpoch = isRecord(payload) && typeof payload.run_epoch === "number" ? payload.run_epoch : undefined
    return { type: parsed.type, runEpoch }
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertNever(value: never): never {
  throw new Error(`unhandled task status: ${String(value)}`)
}

import { Buffer } from "node:buffer"
import {
  REFLECTION_SNAPSHOT_MAX_BYTES,
  countCompletedSteps,
  type ReflectionSnapshot,
  type ReflectionTranscriptState,
} from "../journal"

export type ReflectionTrigger = "step-count" | "compaction" | "manual" | "dream"
export type DreamOrigin = "manual" | "idle" | "shutdown" | "pressure"
export type ReflectionOutcome =
  | "merged"
  | "no_changes"
  | "parent_dirty"
  | "merge_conflict"
  | "dirty_uncommitted"
  | "failed"
  | "timed_out"

export interface TriggerConfig {
  readonly stepCount?: number
  readonly onCompaction?: boolean
  /** Backlog byte budget; a transcript past it triggers reflection even below the step threshold. */
  readonly snapshotMaxBytes?: number
}

export interface JournalSnapshot {
  readonly conversationId: string
  readonly state: ReflectionTranscriptState
  readonly snapshot: ReflectionSnapshot | null
}

export interface CapturedConversation {
  readonly conversationId: string
  readonly snapshot: ReflectionSnapshot
}

export interface ReflectionRequest {
  readonly trigger: ReflectionTrigger
  readonly origin?: DreamOrigin
  readonly conversationIds: readonly string[]
  readonly snapshots: readonly CapturedConversation[]
  readonly focus?: string
  readonly recentN?: number
  readonly targetDoc?: string
}

export interface ReservedRun {
  readonly runId: string
  readonly request: ReflectionRequest
  readonly reservedAt?: string
  readonly launcherPid?: number
  readonly launcherHostname?: string
  readonly launcherProcessStart?: string | null
}

export interface ReservationState {
  readonly active?: ReservedRun
  readonly pending?: ReservedRun
}

export interface MachineState {
  readonly journal: JournalSnapshot
  readonly reservation: ReservationState
  readonly config: TriggerConfig
}

export type ReflectionEvent =
  | { readonly kind: "settled"; readonly success: boolean }
  | { readonly kind: "compaction_accepted" }
  | {
      readonly kind: "manual"
      readonly focus?: string
      readonly recentN?: number
      readonly conversationIds?: readonly string[]
    }

export type EvaluationAction =
  | { readonly kind: "none" }
  | { readonly kind: "reserve"; readonly request: ReflectionRequest }

export interface EvaluationResult {
  readonly state: MachineState
  readonly action: EvaluationAction
}

export interface CompleteTransition {
  readonly state: ReservationState
  readonly finalize: readonly CapturedConversation[]
  readonly clearPendingCompaction: readonly string[]
  readonly launch?: ReservedRun
}

// Bound the shared pending slot to 32 conversations and 4 MiB of UTF-8 JSON: roughly
// 32 default 128 KiB capture windows, instead of an ever-growing multi-session backlog.
// Eviction removes whole conversations in first-seen order; their journal cursors stay retryable.
export const REFLECTION_PENDING_MAX_CONVERSATIONS = 32
export const REFLECTION_PENDING_MAX_BYTES = 4 * 1024 * 1024

const REFLECTION_PRIORITY: Record<Exclude<ReflectionTrigger, "dream">, number> = {
  "step-count": 1,
  compaction: 2,
  manual: 3,
}

const DREAM_PRIORITY: Record<DreamOrigin, number> = {
  idle: 1.5,
  pressure: 1.5,
  shutdown: 2.5,
  manual: 3,
}

export function evaluateTransitions(state: MachineState, event: ReflectionEvent): EvaluationResult {
  if (event.kind === "compaction_accepted") {
    return {
      state: {
        ...state,
        journal: { ...state.journal, state: { ...state.journal.state, pending_compaction: true } },
      },
      action: { kind: "none" },
    }
  }
  if (event.kind === "manual") {
    const ids = event.conversationIds?.length ? event.conversationIds : [state.journal.conversationId]
    return { state, action: { kind: "reserve", request: makeRequest(state.journal, "manual", ids, event) } }
  }
  if (!event.success) return { state, action: { kind: "none" } }

  const compactionReady =
    state.config.onCompaction === true &&
    state.journal.state.pending_compaction === true &&
    !containsTrigger(state.reservation, "compaction")
  if (compactionReady) {
    return { state, action: { kind: "reserve", request: makeRequest(state.journal, "compaction") } }
  }

  const threshold = state.config.stepCount
  const stepCountFree = !containsTrigger(state.reservation, "step-count")
  const thresholdReady =
    threshold !== undefined &&
    threshold > 0 &&
    state.journal.state.steps_since_last_successful_reflection >= threshold &&
    stepCountFree
  if (thresholdReady) {
    return { state, action: { kind: "reserve", request: makeRequest(state.journal, "step-count") } }
  }

  // Byte pressure is its own trigger: a few very large steps overflow the payload budget long
  // before the step threshold fires, and each capture only drains one budget's worth.
  const budget = state.config.snapshotMaxBytes ?? REFLECTION_SNAPSHOT_MAX_BYTES
  const backlogReady =
    budget > 0 && (state.journal.state.unreflected_bytes ?? 0) >= budget && stepCountFree
  return backlogReady
    ? { state, action: { kind: "reserve", request: makeRequest(state.journal, "step-count") } }
    : { state, action: { kind: "none" } }
}

export const evaluate = evaluateTransitions

export function reserveTransition(
  state: ReservationState,
  request: ReflectionRequest,
  runId: string,
): { readonly state: ReservationState; readonly result: "active" | "pending" } {
  if (!state.active) return { state: { active: { runId, request } }, result: "active" }
  const pending = state.pending
    ? { runId: state.pending.runId, request: mergeRequests(state.pending.request, request) }
    : { runId, request }
  return { state: { active: state.active, pending: capPendingRun(pending) }, result: "pending" }
}

function capPendingRun(run: ReservedRun): ReservedRun {
  const { request } = run
  const weights = new Map<string, number>()
  for (const id of request.conversationIds) {
    weights.set(id, (weights.get(id) ?? 0) + Buffer.byteLength(JSON.stringify(id), "utf8") + 8)
  }
  for (const captured of request.snapshots) {
    const json = JSON.stringify(captured, null, 2)
    // Snapshots are nested six spaces into pending.json; include every physical JSON line,
    // the comma and newline, not just transcript characters (escaping and UTF-8 both matter).
    const bytes = Buffer.byteLength(json, "utf8") + 6 * json.split("\n").length + 2
    weights.set(captured.conversationId, (weights.get(captured.conversationId) ?? 0) + bytes)
  }
  const empty = { ...run, request: { ...request, conversationIds: [], snapshots: [] } }
  // Reserve array-opening/closing whitespace too. This conservatively overcounts by at
  // most 16 bytes, and avoids repeatedly serializing a potentially huge merged payload.
  let bytes = Buffer.byteLength(`${JSON.stringify(empty, null, 2)}\n`, "utf8") + 16
  for (const weight of weights.values()) bytes += weight
  let conversations = weights.size
  const evicted = new Set<string>()
  for (const [id, weight] of weights) {
    if (conversations <= REFLECTION_PENDING_MAX_CONVERSATIONS && bytes <= REFLECTION_PENDING_MAX_BYTES) break
    evicted.add(id)
    conversations -= 1
    bytes -= weight
  }
  if (evicted.size === 0) return run
  return {
    ...run,
    request: {
      ...request,
      conversationIds: request.conversationIds.filter((id) => !evicted.has(id)),
      snapshots: request.snapshots.filter((captured) => !evicted.has(captured.conversationId)),
    },
  }
}

export function completeTransition(
  state: ReservationState,
  runId: string,
  outcome: ReflectionOutcome,
  journals: ReadonlyMap<string, JournalSnapshot>,
  config: TriggerConfig,
): CompleteTransition {
  if (state.active?.runId !== runId) throw new Error(`Reflection run is not active: ${runId}`)
  const succeeded = outcome === "merged" || outcome === "no_changes"
  const finalize = succeeded ? state.active.request.snapshots : []
  const clearPendingCompaction =
    succeeded && state.active.request.trigger === "compaction"
      ? state.active.request.conversationIds.filter((id) => journals.get(id)?.state.pending_compaction)
      : []
  const effectiveJournals = new Map(journals)
  for (const captured of finalize) {
    const current = effectiveJournals.get(captured.conversationId)
    if (!current) continue
    const reflected = Math.min(
      current.state.total_completed_steps,
      current.state.reflected_completed_steps + countCompletedSteps(captured.snapshot.entries),
    )
    effectiveJournals.set(captured.conversationId, {
      ...current,
      state: {
        ...current.state,
        reflected_completed_steps: reflected,
        steps_since_last_successful_reflection: current.state.total_completed_steps - reflected,
      },
    })
  }
  for (const conversationId of clearPendingCompaction) {
    const current = effectiveJournals.get(conversationId)
    if (current) {
      effectiveJournals.set(conversationId, {
        ...current,
        state: { ...current.state, pending_compaction: false },
      })
    }
  }
  const pending = state.pending === undefined ? undefined : capPendingRun(state.pending)
  if (!pending || !isStillTriggered(pending.request, effectiveJournals, config)) {
    return { state: {}, finalize, clearPendingCompaction }
  }
  return { state: { active: pending }, finalize, clearPendingCompaction, launch: pending }
}

function makeRequest(
  journal: JournalSnapshot,
  trigger: Exclude<ReflectionTrigger, "dream">,
  conversationIds: readonly string[] = [journal.conversationId],
  options: { readonly focus?: string; readonly recentN?: number } = {},
): ReflectionRequest {
  return {
    trigger,
    conversationIds: unique(conversationIds),
    snapshots: journal.snapshot ? [{ conversationId: journal.conversationId, snapshot: journal.snapshot }] : [],
    ...(options.focus === undefined ? {} : { focus: options.focus }),
    ...(options.recentN === undefined ? {} : { recentN: options.recentN }),
  }
}

function containsTrigger(state: ReservationState, trigger: ReflectionTrigger): boolean {
  return state.active?.request.trigger === trigger || state.pending?.request.trigger === trigger
}

function mergeRequests(left: ReflectionRequest, right: ReflectionRequest): ReflectionRequest {
  const strongest = requestPriority(right) >= requestPriority(left) ? right : left
  const merged = {
    conversationIds: unique([...left.conversationIds, ...right.conversationIds]),
    snapshots: mergeSnapshots(left.snapshots, right.snapshots),
    focus: strongest.focus,
    recentN: Math.max(left.recentN ?? 0, right.recentN ?? 0) || undefined,
    targetDoc: strongest.targetDoc,
  }
  return strongest.trigger === "dream"
    ? { ...merged, trigger: "dream", origin: strongest.origin }
    : { ...merged, trigger: strongest.trigger }
}

function requestPriority(request: ReflectionRequest): number {
  if (request.trigger !== "dream") return REFLECTION_PRIORITY[request.trigger]
  if (request.origin === undefined) throw new TypeError("dream requests require an origin")
  return DREAM_PRIORITY[request.origin]
}

function mergeSnapshots(left: readonly CapturedConversation[], right: readonly CapturedConversation[]) {
  const merged = new Map(left.map((item) => [item.conversationId, item]))
  for (const item of right) merged.set(item.conversationId, item)
  return [...merged.values()]
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function isStillTriggered(
  request: ReflectionRequest,
  journals: ReadonlyMap<string, JournalSnapshot>,
  config: TriggerConfig,
): boolean {
  if (request.trigger === "manual" || request.trigger === "dream") return true
  if (request.trigger === "compaction") {
    return config.onCompaction === true && request.conversationIds.some((id) => journals.get(id)?.state.pending_compaction === true)
  }
  const threshold = config.stepCount
  const budget = config.snapshotMaxBytes ?? REFLECTION_SNAPSHOT_MAX_BYTES
  return request.conversationIds.some((id) => {
    const journalState = journals.get(id)?.state
    if (!journalState) return false
    if (threshold !== undefined && threshold > 0 && journalState.steps_since_last_successful_reflection >= threshold) {
      return true
    }
    return budget > 0 && (journalState.unreflected_bytes ?? 0) >= budget
  })
}

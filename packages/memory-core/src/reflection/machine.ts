import { countCompletedSteps, type ReflectionSnapshot, type ReflectionTranscriptState } from "../journal"

export type ReflectionTrigger = "step-count" | "compaction" | "manual"
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
  readonly conversationIds: readonly string[]
  readonly snapshots: readonly CapturedConversation[]
  readonly focus?: string
  readonly recentN?: number
}

export interface ReservedRun {
  readonly runId: string
  readonly request: ReflectionRequest
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

const PRIORITY: Record<ReflectionTrigger, number> = {
  "step-count": 1,
  compaction: 2,
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
  const thresholdReady =
    threshold !== undefined &&
    threshold > 0 &&
    state.journal.state.steps_since_last_successful_reflection >= threshold &&
    !containsTrigger(state.reservation, "step-count")
  return thresholdReady
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
  return { state: { active: state.active, pending }, result: "pending" }
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
  const pending = state.pending
  if (!pending || !isStillTriggered(pending.request, effectiveJournals, config)) {
    return { state: {}, finalize, clearPendingCompaction }
  }
  return { state: { active: pending }, finalize, clearPendingCompaction, launch: pending }
}

function makeRequest(
  journal: JournalSnapshot,
  trigger: ReflectionTrigger,
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
  const strongest =
    PRIORITY[right.trigger] > PRIORITY[left.trigger] ||
    (PRIORITY[right.trigger] === PRIORITY[left.trigger] && right.focus !== undefined)
      ? right
      : left
  return {
    trigger: strongest.trigger,
    conversationIds: unique([...left.conversationIds, ...right.conversationIds]),
    snapshots: mergeSnapshots(left.snapshots, right.snapshots),
    focus: strongest.focus,
    recentN: Math.max(left.recentN ?? 0, right.recentN ?? 0) || undefined,
  }
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
  if (request.trigger === "manual") return true
  if (request.trigger === "compaction") {
    return config.onCompaction === true && request.conversationIds.some((id) => journals.get(id)?.state.pending_compaction === true)
  }
  const threshold = config.stepCount
  return threshold !== undefined && threshold > 0 && request.conversationIds.some(
    (id) => (journals.get(id)?.state.steps_since_last_successful_reflection ?? 0) >= threshold,
  )
}

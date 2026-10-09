import type {
  CompletionNotifier,
  ParentState,
  TaskRecord,
  TaskRecordStore,
  TaskStatus,
  TaskTransition,
} from "@oh-my-opencode/senpi-task"

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "error",
  "cancelled",
  "interrupted",
  "lost",
])

export interface CompletionBridgeDeps {
  readonly notifier: CompletionNotifier
  readonly parentState: () => ParentState
  readonly wasBackground: (taskId: string) => boolean
  readonly onTerminal?: (record: TaskRecord) => void
  /**
   * The session this engine currently serves. A reconcile also marks OTHER sessions' crashed children
   * lost; only a child of this session may be notified here, or its own parent would never hear of it
   * (its notification would already be spent on the wrong session). Unknown means no lost notification.
   */
  readonly currentSessionId?: () => string | undefined
}

/**
 * W1-V F7: completion notification is driven by the STORE's terminal transition, never raw agent_end.
 * Wrap the store so that whenever a transition APPLIES a terminal status, notifyTerminal fires once
 * for that record. Reconciliation's `lost` mutation is intercepted too: bounded background
 * revival can finish after session_start's notification recovery has already returned.
 * Notification bookkeeping on an already-terminal record never creates another status edge.
 */
export function createCompletionObservingStore(backing: TaskRecordStore, deps: CompletionBridgeDeps): TaskRecordStore {
  return {
    stateDir: backing.stateDir,
    save: (record) => backing.save(record),
    replace: (record) => backing.replace(record),
    mutate: (taskId, mutation) => {
      let becameLost = false
      const record = backing.mutate(taskId, (fresh) => {
        const next = mutation(fresh)
        becameLost = next.status === "lost" && !TERMINAL_STATUSES.has(fresh.status)
        return next
      })
      if (becameLost && record !== null && record.parent_session_id === deps.currentSessionId?.()) {
        deps.notifier.notifyTerminal({
          record,
          parentState: deps.parentState(),
          runInBackground: deps.wasBackground(taskId),
        })
        deps.onTerminal?.(record)
      }
      return record
    },
    load: (taskId) => backing.load(taskId),
    list: () => backing.list(),
    appendEvent: (taskId, event) => backing.appendEvent(taskId, event),
    remove: (taskId) => backing.remove(taskId),
    transition: (taskId, transition) => {
      const result = backing.transition(taskId, transition)
      if (isTerminalApplied(result.applied, result.record.status, transition)) {
        deps.notifier.notifyTerminal({
          record: result.record,
          parentState: deps.parentState(),
          runInBackground: deps.wasBackground(taskId),
        })
        deps.onTerminal?.(result.record)
      }
      return result
    },
    // TTL expunge is not a terminal transition - forward the two-phase store surface untouched so
    // lifecycle.cleanupExpiredRecords works through the wrapper (no notify on tombstone/expunge).
    tombstoneIfExpired: (taskId, shouldRetain, owner) => backing.tombstoneIfExpired(taskId, shouldRetain, owner),
    completeExpunge: (taskId, owner) => backing.completeExpunge(taskId, owner),
    listExpunging: () => backing.listExpunging(),
    loadExpunging: (taskId) => backing.loadExpunging(taskId),
    restoreExpunging: (taskId, owner) => backing.restoreExpunging(taskId, owner),
    readExpungeOwner: (taskId) => backing.readExpungeOwner(taskId),
    takeOverExpunging: (taskId, from, to) => backing.takeOverExpunging(taskId, from, to),
  }
}

function isTerminalApplied(applied: boolean, status: TaskStatus, transition: TaskTransition): boolean {
  // Residency bookkeeping transitions (evict/dispose/...) also touch terminal records but must not
  // re-notify; only the status-reaching transitions count.
  const statusChanging = transition.type === "complete" || transition.type === "fail" || transition.type === "cancel" || transition.type === "interrupt" || transition.type === "lose"
  return applied && statusChanging && TERMINAL_STATUSES.has(status)
}

import type {
  CompletionNotifier,
  ParentState,
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
}

/**
 * W1-V F7: completion notification is driven by the STORE's terminal transition, never raw agent_end.
 * Wrap the store so that whenever a transition APPLIES a terminal status, notifyTerminal fires once
 * for that record. Only `transition` is intercepted - `replace` (how the notifier persists
 * notified_epoch) is passed straight through, so there is no notify -> persist -> notify recursion.
 */
export function createCompletionObservingStore(backing: TaskRecordStore, deps: CompletionBridgeDeps): TaskRecordStore {
  return {
    stateDir: backing.stateDir,
    save: (record) => backing.save(record),
    replace: (record) => backing.replace(record),
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
      }
      return result
    },
  }
}

function isTerminalApplied(applied: boolean, status: TaskStatus, transition: TaskTransition): boolean {
  // Residency bookkeeping transitions (evict/dispose/...) also touch terminal records but must not
  // re-notify; only the status-reaching transitions count.
  const statusChanging = transition.type === "complete" || transition.type === "fail" || transition.type === "cancel" || transition.type === "interrupt" || transition.type === "lose"
  return applied && statusChanging && TERMINAL_STATUSES.has(status)
}

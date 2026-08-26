import type { TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

/**
 * One nonterminal -> terminal status edge for a task record. `previousStatus` is the status the
 * record carried before the observed write, and is absent when the record first appeared already
 * terminal (a task that died before its first persisted running state).
 */
export interface TaskTerminalEdge {
  readonly record: TaskRecord
  readonly previousStatus?: TaskStatus
}

export type TaskTerminalObserver = (edge: TaskTerminalEdge) => void

export interface TaskTerminalObservers {
  /** Register an observer. The returned function detaches it (session re-register, dispose). */
  readonly subscribe: (observer: TaskTerminalObserver) => () => void
  /** Deliver an edge to every observer. Never throws: an observer failure cannot reach the store. */
  readonly notify: (edge: TaskTerminalEdge) => void
}

// Senpi tears down the extension runner and re-registers every component on a session switch or
// resume, and packaged extensions load through an uncached importer, so every module-scope binding
// in this bundle is rebuilt per load. A ledger held at module scope would leave each earlier
// evaluation's subscribers observing a store nobody writes to any more, so the default ledger hangs
// off globalThis under a registered symbol - one ledger per process, shared by every evaluation.
// Tests inject isolated ledgers through createTaskTerminalObservers() instead.
export const TASK_TERMINAL_OBSERVERS_KEY = Symbol.for("omo.task.terminalObservers")

export function createTaskTerminalObservers(onObserverError?: (error: unknown) => void): TaskTerminalObservers {
  const observers = new Set<TaskTerminalObserver>()
  return {
    subscribe: (observer) => {
      observers.add(observer)
      return () => observers.delete(observer)
    },
    notify: (edge) => {
      for (const observer of observers) {
        try {
          observer(edge)
        } catch (error) {
          // Terminal observation is fire-and-forget telemetry: one failing observer must neither
          // abort the store write that produced the edge nor starve the observers behind it.
          onObserverError?.(error)
        }
      }
    },
  }
}

function isObserverLedger(value: unknown): value is TaskTerminalObservers {
  if (typeof value !== "object" || value === null) return false
  const candidate: Partial<TaskTerminalObservers> = value
  return typeof candidate.subscribe === "function" && typeof candidate.notify === "function"
}

export function sharedTaskTerminalObservers(): TaskTerminalObservers {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[TASK_TERMINAL_OBSERVERS_KEY]
  if (isObserverLedger(existing)) return existing
  const created = createTaskTerminalObservers()
  registry[TASK_TERMINAL_OBSERVERS_KEY] = created
  return created
}

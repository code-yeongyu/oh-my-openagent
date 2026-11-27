// Helpers for the child-gate cases of a waiting node (#15150 stack reviews): a manager whose stops can be
// left unconfirmed, the node flags the frontier writes, and a guard that turns a waiter spin into a failure.
import type { liveParentFixture } from "../../lifecycle/__fixtures__/live-parent-fakes"
import type { TaskManager } from "../../manager/types"
import { subscribeDagJournal } from "../journal"
import type { DagFileStore } from "../store"
import { runId } from "./reattached-run"

type Fixture = ReturnType<typeof liveParentFixture>

/** The real manager with some of its methods replaced. */
export function managerWith(manager: TaskManager, overrides: Partial<TaskManager>): TaskManager {
  return new Proxy(manager, {
    get(target, property) {
      const override: unknown = Reflect.get(overrides, property)
      if (override !== undefined) return override
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

/** The real manager, except that a stop of `unconfirmed` (its first `times` asks) is answered cancel_pending and changes nothing. */
export function withUnconfirmedStop(
  manager: TaskManager,
  unconfirmed: string,
  times = Number.POSITIVE_INFINITY,
): TaskManager {
  let answered = 0
  return managerWith(manager, {
    cancelTask: (taskId, ...rest) =>
      taskId === unconfirmed && answered++ < times
        ? Promise.resolve({
            kind: "cancel_pending" as const,
            task_id: taskId,
            previous_status: "running" as const,
            reason: "child unreachable",
          })
        : manager.cancelTask(taskId, ...rest),
  })
}

/** The message of the next node flag journaled for `nodeId`, subscribed before the action. */
export function nodeFlag(store: DagFileStore, nodeId: string): Promise<string> {
  const seen = Promise.withResolvers<string>()
  const stop = subscribeDagJournal(store, runId, (event) => {
    if (event.type !== "dag.diagnostic.added" || event.diagnostic.kind !== "node_flag") return
    if (event.diagnostic.nodeId !== nodeId) return
    stop()
    seen.resolve(event.diagnostic.message)
  })
  return seen.promise
}

/** Resolves on the run's next journal event of `type`, subscribed before the action. */
export function journalEvent(store: DagFileStore, type: string): Promise<undefined> {
  const seen = Promise.withResolvers<undefined>()
  const stop = subscribeDagJournal(store, runId, (event) => {
    if (event.type !== type) return
    stop()
    seen.resolve(undefined)
  })
  return seen.promise
}

/** Makes the node's own child a stale attempt of its node (its owner names an earlier attempt). */
export function makeNotCurrent(f: Fixture, taskId: string): void {
  f.store.mutate(taskId, (record) =>
    record.owner === undefined ? record : { ...record, owner: { ...record.owner, execAttempt: -1 } },
  )
}

// More reads of the task store than this between two events can only be a waiter deciding again and
// again on microtasks alone: the guard throws, which settles the run instead of starving the process.
const SPIN_LIMIT = 1_000

/**
 * The manager with every scheduler read of a task (`get`, `findOwnedTasks`) counted from the last
 * `mark()`. A waiter that decides again without an event re-reads the store each time; past the limit
 * the read throws so the spin ends and the test fails on the count instead of hanging.
 */
export function spinGuard(manager: TaskManager) {
  let reads = 0
  const read = (): void => {
    reads += 1
    if (reads > SPIN_LIMIT) throw new Error(`waiter spin: ${reads} task reads without an event`)
  }
  const taskManager = managerWith(manager, {
    get: (taskId) => {
      read()
      return manager.get(taskId)
    },
    findOwnedTasks: (owner) => {
      read()
      return manager.findOwnedTasks(owner)
    },
  })
  return {
    taskManager,
    reads: () => reads,
    mark: () => {
      reads = 0
    },
  }
}

import type { TaskRecord, TaskRecordStore } from "@oh-my-opencode/senpi-task"

import { watchStatusEdge } from "./store-status-edge"
import type { TaskTerminalObservers } from "./terminal-observers"

// Wrap a store so every record mutation (save/replace/transition/remove) fires a listener. The task
// component subscribes its debounced UI sync here so a background spawn or completion refreshes the
// footer/widget without polling. Reads (load/list) never fire - they cannot change task state.
//
// The same wrapper is the ONE seam that sees every status-bearing write, so an optional terminal
// observer ledger is notified here on each nonterminal -> terminal status edge. `transition` alone
// would miss reconciliation, which writes `lost` through replace/mutate.
// The record a mutation left behind (null once removed), so a listener can update in place.
export type StoreMutation = { readonly taskId: string; readonly record: TaskRecord | null }

export function createMutationNotifyingStore(
  backing: TaskRecordStore,
  onMutation: (change: StoreMutation) => void,
  terminalObservers?: TaskTerminalObservers,
): TaskRecordStore {
  const watch = (taskId: string) => watchStatusEdge({ backing, observers: terminalObservers, taskId })
  return {
    stateDir: backing.stateDir,
    save: (record) => {
      const edge = watch(record.task_id)
      backing.save(record)
      onMutation({ taskId: record.task_id, record })
      edge.settle(record)
    },
    replace: (record) => {
      const edge = watch(record.task_id)
      backing.replace(record)
      onMutation({ taskId: record.task_id, record })
      edge.settle(record)
    },
    mutate: (taskId, mutation) => {
      const edge = watch(taskId)
      const result = backing.mutate(taskId, mutation)
      onMutation({ taskId, record: result })
      edge.settle(result)
      return result
    },
    load: (taskId) => backing.load(taskId),
    list: () => backing.list(),
    appendEvent: (taskId, event) => backing.appendEvent(taskId, event),
    remove: (taskId) => {
      backing.remove(taskId)
      onMutation({ taskId, record: null })
    },
    transition: (taskId, transition) => {
      const edge = watch(taskId)
      const result = backing.transition(taskId, transition)
      onMutation({ taskId, record: result.applied ? result.record : backing.load(taskId) })
      if (result.applied) edge.settle(result.record)
      return result
    },
    tombstoneIfExpired: (taskId, shouldRetain, owner) => {
      const result = backing.tombstoneIfExpired(taskId, shouldRetain, owner)
      if (result.kind === "tombstoned") onMutation({ taskId, record: null })
      return result
    },
    completeExpunge: (taskId, owner) => {
      const deleted = backing.completeExpunge(taskId, owner)
      onMutation({ taskId, record: null })
      return deleted
    },
    listExpunging: () => backing.listExpunging(),
    loadExpunging: (taskId) => backing.loadExpunging(taskId),
    restoreExpunging: (taskId, owner) => {
      backing.restoreExpunging(taskId, owner)
      onMutation({ taskId, record: backing.load(taskId) })
    },
    readExpungeOwner: (taskId) => backing.readExpungeOwner(taskId),
    takeOverExpunging: (taskId, from, to) => backing.takeOverExpunging(taskId, from, to),
  }
}

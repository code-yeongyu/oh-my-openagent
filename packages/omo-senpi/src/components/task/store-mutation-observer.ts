import type { TaskRecordStore } from "@oh-my-opencode/senpi-task"

import { watchStatusEdge } from "./store-status-edge"
import type { TaskTerminalObservers } from "./terminal-observers"

// Wrap a store so every record mutation (save/replace/transition/remove) fires a listener. The task
// component subscribes its debounced UI sync here so a background spawn or completion refreshes the
// footer/widget without polling. Reads (load/list) never fire - they cannot change task state.
//
// The same wrapper is the ONE seam that sees every status-bearing write, so an optional terminal
// observer ledger is notified here on each nonterminal -> terminal status edge. `transition` alone
// would miss reconciliation, which writes `lost` through replace/mutate.
export function createMutationNotifyingStore(
  backing: TaskRecordStore,
  onMutation: () => void,
  terminalObservers?: TaskTerminalObservers,
): TaskRecordStore {
  const watch = (taskId: string) => watchStatusEdge({ backing, observers: terminalObservers, taskId })
  return {
    stateDir: backing.stateDir,
    save: (record) => {
      const edge = watch(record.task_id)
      backing.save(record)
      onMutation()
      edge.settle(record)
    },
    replace: (record) => {
      const edge = watch(record.task_id)
      backing.replace(record)
      onMutation()
      edge.settle(record)
    },
    mutate: (taskId, mutation) => {
      const edge = watch(taskId)
      const result = backing.mutate(taskId, mutation)
      onMutation()
      edge.settle(result)
      return result
    },
    load: (taskId) => backing.load(taskId),
    list: () => backing.list(),
    appendEvent: (taskId, event) => backing.appendEvent(taskId, event),
    remove: (taskId) => {
      backing.remove(taskId)
      onMutation()
    },
    transition: (taskId, transition) => {
      const edge = watch(taskId)
      const result = backing.transition(taskId, transition)
      onMutation()
      if (result.applied) edge.settle(result.record)
      return result
    },
    tombstoneIfExpired: (taskId, shouldRetain) => {
      const result = backing.tombstoneIfExpired(taskId, shouldRetain)
      if (result.kind === "tombstoned") onMutation()
      return result
    },
    completeExpunge: (taskId) => {
      backing.completeExpunge(taskId)
      onMutation()
    },
    listExpunging: () => backing.listExpunging(),
  }
}

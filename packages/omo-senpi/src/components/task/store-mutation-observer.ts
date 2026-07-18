import type { TaskRecordStore } from "@oh-my-opencode/senpi-task"

// Wrap a store so every record mutation (save/replace/transition/remove) fires a listener. The task
// component subscribes its debounced UI sync here so a background spawn or completion refreshes the
// footer/widget without polling. Reads (load/list) never fire - they cannot change task state.
export function createMutationNotifyingStore(backing: TaskRecordStore, onMutation: () => void): TaskRecordStore {
  return {
    stateDir: backing.stateDir,
    save: (record) => {
      backing.save(record)
      onMutation()
    },
    replace: (record) => {
      backing.replace(record)
      onMutation()
    },
    load: (taskId) => backing.load(taskId),
    list: () => backing.list(),
    appendEvent: (taskId, event) => backing.appendEvent(taskId, event),
    remove: (taskId) => {
      backing.remove(taskId)
      onMutation()
    },
    transition: (taskId, transition) => {
      const result = backing.transition(taskId, transition)
      onMutation()
      return result
    },
  }
}

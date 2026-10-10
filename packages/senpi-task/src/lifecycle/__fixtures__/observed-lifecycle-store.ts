import type { TaskRecord } from "../../state"
import type { TaskRecordStore } from "../../store"

const terminal = new Set(["completed", "error", "lost", "cancelled", "interrupted"])

export function observeLifecycleStore(
  backing: TaskRecordStore,
  hooks: {
    changed(): void
    terminal(record: TaskRecord): void
    event(type: string): void
    beforeMutate(): void
  },
): TaskRecordStore {
  function changed(before: TaskRecord | null, after: TaskRecord | null) {
    if (after !== null && terminal.has(after.status) && before?.status !== after.status) hooks.terminal(after)
    hooks.changed()
  }
  return {
    ...backing,
    save(record) {
      const before = backing.load(record.task_id)
      backing.save(record)
      changed(before, record)
    },
    replace(record) {
      const before = backing.load(record.task_id)
      backing.replace(record)
      changed(before, record)
    },
    mutate(id, fn) {
      const before = backing.load(id)
      const after = backing.mutate(id, (fresh) => {
        hooks.beforeMutate()
        return fn(fresh)
      })
      changed(before, after)
      return after
    },
    transition(id, transition) {
      const before = backing.load(id)
      const result = backing.transition(id, transition)
      if (result.applied) changed(before, result.record)
      return result
    },
    appendEvent(id, event) {
      const path = backing.appendEvent(id, event)
      hooks.event(event.type)
      return path
    },
  }
}

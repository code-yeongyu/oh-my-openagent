import type { TaskRecordStore } from "../../store"

export function collisionStore(inner: TaskRecordStore): { readonly store: TaskRecordStore; readonly firstCandidate: () => string | undefined } {
  let firstSave = true
  let firstCandidate: string | undefined
  return {
    store: {
      ...inner,
      save(record) {
        if (firstSave) {
          firstSave = false
          firstCandidate = record.task_id
          inner.save({ ...record, name: "foreign-winner" })
        }
        inner.save(record)
      },
    },
    firstCandidate: () => firstCandidate,
  }
}

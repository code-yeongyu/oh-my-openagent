import { bumpTaskId, parseTaskId, syncTaskIdFloor } from "../state"
import type { TaskRecord } from "../state"
import { TaskRecordCollisionError } from "./record-store"
import type { TaskRecordStore } from "./types"

const DEFAULT_MAX_CLAIM_ATTEMPTS = 4096

export type ClaimOptions = { readonly maxAttempts?: number; readonly nameFollowsId?: boolean }

export function claimTaskRecord(store: TaskRecordStore, draft: TaskRecord, options?: ClaimOptions): TaskRecord {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_CLAIM_ATTEMPTS
  let candidate = draft
  for (let attempt = 1; ; attempt++) {
    try {
      store.save(candidate)
      syncTaskIdFloor(parseTaskId(candidate.task_id))
      return candidate
    } catch (error) {
      if (!(error instanceof TaskRecordCollisionError) || attempt >= maxAttempts) throw error
      const nextId = bumpTaskId(error.taskId)
      candidate = { ...candidate, task_id: nextId, ...(options?.nameFollowsId === true ? { name: nextId } : {}) }
    }
  }
}

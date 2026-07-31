import { bumpTaskId, parseTaskId, syncTaskIdFloor } from "../state"
import { TaskIdSpaceExhaustedError } from "../state/id"
import type { TaskRecord } from "../state"
import { TaskRecordCollisionError } from "./record-store"
import type { TaskRecordStore } from "./types"

const DEFAULT_MAX_CLAIM_ATTEMPTS = 4096

export type ClaimOptions = {
  readonly maxAttempts?: number
  readonly nameFollowsId?: boolean
  readonly nameAvailable?: (name: string) => boolean
}

export function claimTaskRecord(store: TaskRecordStore, draft: TaskRecord, options?: ClaimOptions): TaskRecord {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_CLAIM_ATTEMPTS
  let attempts = 0
  let candidate = draft
  for (;;) {
    const nameAvailable = options?.nameAvailable
    while (options?.nameFollowsId === true && nameAvailable !== undefined && !nameAvailable(candidate.name ?? candidate.task_id)) {
      if (attempts >= maxAttempts) throw new TaskIdSpaceExhaustedError()
      attempts += 1
      const nextId = bumpTaskId(parseTaskId(candidate.task_id))
      candidate = { ...candidate, task_id: nextId, name: nextId }
    }
    try {
      if (attempts >= maxAttempts) throw new TaskIdSpaceExhaustedError()
      attempts += 1
      store.save(candidate)
      syncTaskIdFloor(parseTaskId(candidate.task_id))
      return candidate
    } catch (error) {
      if (!(error instanceof TaskRecordCollisionError) || attempts >= maxAttempts) throw error
      const nextId = bumpTaskId(error.taskId)
      candidate = { ...candidate, task_id: nextId, ...(options?.nameFollowsId === true ? { name: nextId } : {}) }
    }
  }
}

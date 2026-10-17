import type { DelegateTaskArgs } from "./types"
import { log } from "../../shared/logger"

export const CONTINUATION_SESSION_ID_PREFIX = "ses_"

export function getTaskID(args: Pick<DelegateTaskArgs, "task_id">): string | undefined {
  return args.task_id
}

export function normalizeContinuationTaskID(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  if (!trimmed.startsWith(CONTINUATION_SESSION_ID_PREFIX) || trimmed.length === CONTINUATION_SESSION_ID_PREFIX.length) {
    log("[task] ignoring invalid task_id; not a ses_ continuation session id - spawning a new task instead", {
      task_id: trimmed,
    })
    return undefined
  }
  return trimmed
}

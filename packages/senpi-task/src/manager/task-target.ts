import type { TaskRecord } from "../state"
import { nicknameOccurrenceAliases } from "./nickname-format"

/** IDs and exact canonical names keep their existing precedence. Nicknames never leave the caller's children. */
export function resolveTaskTarget(
  records: readonly TaskRecord[],
  target: string,
  callerSessionId?: string,
): TaskRecord | undefined {
  const canonical = records.find((record) => record.task_id === target) ?? records.find((record) => record.name === target)
  if (canonical !== undefined || callerSessionId === undefined || target === "*") return canonical

  const owned = records.filter((record) => record.parent_session_id === callerSessionId && record.nickname !== undefined)
  const exact = owned.filter((record) => record.nickname === target)
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined

  const normalized = target.toLowerCase()
  const equivalent = owned.filter((record) =>
    nicknameOccurrenceAliases(record.nickname ?? "").some((alias) => alias.toLowerCase() === normalized),
  )
  return equivalent.length === 1 ? equivalent[0] : undefined
}

export function taskReferenceLabel(taskId: string, nickname?: string): string {
  return nickname === undefined || nickname === taskId ? taskId : `${nickname} (${taskId})`
}

import type { TaskRecord } from "../state"

export type ContinuationOwnershipDenial = "missing_caller" | "foreign_caller"

export type ContinuationOwnershipDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ContinuationOwnershipDenial }

export function decideContinuationOwnership(
  record: TaskRecord,
  callerSessionId: string | undefined,
): ContinuationOwnershipDecision {
  if (callerSessionId === undefined) return { allowed: false, reason: "missing_caller" }
  if (callerSessionId !== record.parent_session_id) return { allowed: false, reason: "foreign_caller" }
  return { allowed: true }
}

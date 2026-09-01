import type { ReflectionFinalizeResult } from "@oh-my-opencode/memory-core"

export function failureReason(result: ReflectionFinalizeResult): { readonly reason?: string } {
  if (result.status === "dirty_uncommitted") return { reason: "completion_validation" }
  if (result.status === "parent_dirty" || result.status === "merge_conflict") return { reason: "integration_failed" }
  if (result.status !== "failed") return {}
  return { reason: result.detail && /Git administration|recorded launch SHA|changed paths|no HEAD commit|escapes the memory repository/i.test(result.detail)
    ? "completion_validation"
    : "integration_failed" }
}

export function cleanupSucceeded(result: ReflectionFinalizeResult): boolean {
  return result.cleanup.worktreeRemoved && result.cleanup.branchRemoved
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

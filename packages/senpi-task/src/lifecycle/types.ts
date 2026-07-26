import type { AgentLimitReached } from "./errors"
import type { DestroyCause } from "./port"

export type AdmissionResult =
  | { readonly kind: "admitted" }
  | { readonly kind: "evicted"; readonly evicted_task_id: string }
  | { readonly kind: "rejected"; readonly error: AgentLimitReached }

export type ReconcileOutcomeKind = "resumed" | "lost" | "lost_and_terminated" | "foreign_live_owner"

export type ReconcileOutcome = {
  readonly task_id: string
  readonly kind: ReconcileOutcomeKind
  readonly reason?: string
}

export type ReconcileResult = {
  readonly outcomes: readonly ReconcileOutcome[]
}

export type CleanupResult = {
  readonly deleted: readonly string[]
  readonly retained: readonly string[]
}

export type TeardownSummary = {
  readonly in_process: number
  readonly rpc: number
  readonly total: number
}

export type TaskLifecycle = {
  destroyResidentTask(taskId: string, cause: DestroyCause): Promise<void>
  admitResident(parentSessionId: string): Promise<AdmissionResult>
  reconcileOnSessionStart(): Promise<ReconcileResult>
  cleanupExpiredRecords(): CleanupResult
  teardownOnSessionShutdown(): Promise<TeardownSummary>
}

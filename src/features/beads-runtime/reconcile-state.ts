export type BeadsRuntimeReconcileStatus =
  | "not-attached"
  | "pending"
  | "reconciled"
  | "stale"
  | "failed"

export interface BeadsRuntimeReconcileState {
  status: BeadsRuntimeReconcileStatus
  checkedAt?: string
  reason?: string
}

export function createDetachedBeadsReconcileState(): BeadsRuntimeReconcileState {
  return { status: "not-attached" }
}

export function createPendingBeadsReconcileState(
  checkedAt?: string,
): BeadsRuntimeReconcileState {
  return {
    status: "pending",
    checkedAt,
  }
}

export function createReconciledBeadsReconcileState(
  checkedAt?: string,
): BeadsRuntimeReconcileState {
  return {
    status: "reconciled",
    checkedAt,
  }
}

export function createStaleBeadsReconcileState(
  reason: string,
  checkedAt?: string,
): BeadsRuntimeReconcileState {
  return {
    status: "stale",
    checkedAt,
    reason,
  }
}

export function createFailedBeadsReconcileState(
  reason: string,
  checkedAt?: string,
): BeadsRuntimeReconcileState {
  return {
    status: "failed",
    checkedAt,
    reason,
  }
}

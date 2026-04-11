import type { BeadsRuntimeAttachState } from "./attach-state"
import type { BeadsRuntimeReconcileState } from "./reconcile-state"

export interface BeadsRuntimeTaskMetadata {
  beadID?: string
  sourceCommand?: string
  worktreePath?: string
  attachState?: BeadsRuntimeAttachState
  reconcileState?: BeadsRuntimeReconcileState
  lastReconciledAt?: string
}

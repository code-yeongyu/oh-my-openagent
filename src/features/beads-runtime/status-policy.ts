export interface BeadsRuntimeStatusPolicy {
  awarenessMode: "read-reconcile-only"
  autoClaim: false
  autoClose: false
  requiresExplicitAttach: true
  allowedReadCommands: readonly string[]
  blockedOwnershipActions: readonly string[]
  summary: string
}

export const BEADS_RUNTIME_STATUS_POLICY: BeadsRuntimeStatusPolicy = {
  awarenessMode: "read-reconcile-only",
  autoClaim: false,
  autoClose: false,
  requiresExplicitAttach: true,
  allowedReadCommands: ["br ready --json", "br list --status in_progress --json", "br show <id> --json"],
  blockedOwnershipActions: ["br update --claim", "br close", "br sync --flush-only"],
  summary:
    "OMO is bead-aware for read and reconcile flows only in MVP. Claim, close, and sync ownership remain with explicit OCK workflows.",
}

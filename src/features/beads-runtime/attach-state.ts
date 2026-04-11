export type BeadsRuntimeAttachSource = "ock-command" | "runtime-metadata"

export interface DetachedBeadsRuntimeAttachState {
  status: "detached"
}

export interface AttachedBeadsRuntimeAttachState {
  status: "attached"
  beadID: string
  source: BeadsRuntimeAttachSource
  sourceCommand: string
  attachedAt?: string
  worktreePath?: string
}

export type BeadsRuntimeAttachState =
  | DetachedBeadsRuntimeAttachState
  | AttachedBeadsRuntimeAttachState

export function createDetachedBeadsAttachState(): DetachedBeadsRuntimeAttachState {
  return { status: "detached" }
}

export function createAttachedBeadsAttachState(input: {
  beadID: string
  sourceCommand: string
  source?: BeadsRuntimeAttachSource
  attachedAt?: string
  worktreePath?: string
}): AttachedBeadsRuntimeAttachState {
  return {
    status: "attached",
    beadID: input.beadID,
    source: input.source ?? "ock-command",
    sourceCommand: input.sourceCommand,
    attachedAt: input.attachedAt,
    worktreePath: input.worktreePath,
  }
}

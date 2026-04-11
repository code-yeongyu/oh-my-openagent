import type { BeadsRuntimeAttachInput } from "./attachment-operations"
import type { BeadsRuntimeAttachmentRecord } from "./attachment-registry"

export function createAttachmentRecord(args: {
  directory: string
  activePlan: string
  startedAt: string
  input: BeadsRuntimeAttachInput
  attachedAt: string
}): BeadsRuntimeAttachmentRecord {
  const worktreePath = args.input.worktreePath ?? args.directory
  return {
    beadID: args.input.beadID,
    continuationKey: `${args.activePlan}::${args.startedAt}`,
    continuationDirectory: args.directory,
    activePlan: args.activePlan,
    startedAt: args.startedAt,
    sourceCommand: args.input.sourceCommand,
    worktreePath,
    attachedAt: args.attachedAt,
    ...(args.input.branchName ? { branchName: args.input.branchName } : {}),
    ...(args.input.worktreeName ? { worktreeName: args.input.worktreeName } : {}),
  }
}

export function resolveAttachmentRegistryDirectory(args: {
  directory: string
  input: BeadsRuntimeAttachInput
  state: { bead_worktree_path?: string; worktree_path?: string }
}): string {
  return args.input.worktreePath
    ?? args.state.bead_worktree_path
    ?? args.state.worktree_path
    ?? args.directory
}

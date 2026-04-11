import { applyBeadsRuntimeToBoulderState, getPlanProgress, readBoulderState, writeBoulderState } from "../boulder-state"
import {
  type BeadsRuntimeCommandRunner,
  runBeadsRuntimeCommand,
} from "./br-command-runner"
import { resolveBeadsRuntimeCommandCwd } from "./br-command-cwd"
import { createAttachedBeadsAttachState } from "./attach-state"
import { createBeadsRuntimeAttachError } from "./errors"
import { assertBeadIsClaimedInProgress, getContinuationStateOrThrow } from "./attach-preconditions"
import { createAttachmentRecord, resolveAttachmentRegistryDirectory } from "./attachment-record"
import {
  pruneInactiveBeadsRuntimeAttachments,
  type BeadsRuntimeAttachmentRecord,
  writeBeadsRuntimeAttachmentRegistry,
} from "./attachment-registry"

export interface BeadsRuntimeAttachInput {
  beadID: string
  sourceCommand: "start" | "resume"
  worktreePath?: string
  branchName?: string
  worktreeName?: string
}

export interface BeadsRuntimeAttachResult {
  beadID: string
  sourceCommand: "start" | "resume"
  worktreePath: string
  attachedAt: string
  branchName?: string
  worktreeName?: string
}

export interface BeadsRuntimeStatusSnapshot {
  activeContinuation: boolean
  beadID?: string
  sourceCommand?: string
  worktreePath?: string
  branchName?: string
  worktreeName?: string
}

export async function attachBeadToContinuation(args: {
  directory: string
  sessionID: string
  input: BeadsRuntimeAttachInput
  runner?: BeadsRuntimeCommandRunner
}): Promise<BeadsRuntimeAttachResult> {
  const beadID = args.input.beadID.trim()
  if (!beadID) {
    throw createBeadsRuntimeAttachError({
      message: "beads runtime attach requires an explicit bead_id selected by the caller",
    })
  }

  const runner = args.runner ?? runBeadsRuntimeCommand
  const state = getContinuationStateOrThrow(args.directory, args.sessionID)
  const cwd = resolveBeadsRuntimeCommandCwd({
    directory: args.directory,
    state,
    worktreePath: args.input.worktreePath,
  })
  await assertBeadIsClaimedInProgress({ beadID, cwd, runner })

  const attachedAt = new Date().toISOString()
  const registryDirectory = resolveAttachmentRegistryDirectory({
    directory: args.directory,
    input: { ...args.input, beadID },
    state,
  })
  const nextRecord = createAttachmentRecord({
    directory: args.directory,
    activePlan: state.active_plan,
    startedAt: state.started_at,
    input: { ...args.input, beadID },
    attachedAt,
  })

  const registry = pruneInactiveBeadsRuntimeAttachments(registryDirectory)
  const existing = registry[beadID]
  if (existing && existing.continuationKey !== nextRecord.continuationKey) {
    const existingDetails: Record<string, unknown> = {
      beadID: existing.beadID,
      continuationKey: existing.continuationKey,
      continuationDirectory: existing.continuationDirectory,
      activePlan: existing.activePlan,
      startedAt: existing.startedAt,
      sourceCommand: existing.sourceCommand,
      worktreePath: existing.worktreePath,
      attachedAt: existing.attachedAt,
      ...(existing.branchName ? { branchName: existing.branchName } : {}),
      ...(existing.worktreeName ? { worktreeName: existing.worktreeName } : {}),
    }

    throw createBeadsRuntimeAttachError({
      message: `beads runtime attach rejected because bead ${beadID} is already attached to another active top-level continuation`,
      details: existingDetails,
    })
  }

  const nextState = applyBeadsRuntimeToBoulderState(state, {
    beadID,
    sourceCommand: args.input.sourceCommand,
    worktreePath: nextRecord.worktreePath,
    attachState: createAttachedBeadsAttachState({
      beadID,
      sourceCommand: args.input.sourceCommand,
      attachedAt,
      worktreePath: nextRecord.worktreePath,
    }),
  })
  if (!writeBoulderState(args.directory, nextState)) {
    throw createBeadsRuntimeAttachError({
      message: "beads runtime attach could not persist boulder state",
      details: { directory: args.directory, beadID },
    })
  }

  writeBeadsRuntimeAttachmentRegistry(registryDirectory, {
    ...registry,
    [beadID]: nextRecord,
  })

  return {
    beadID,
    sourceCommand: args.input.sourceCommand,
    worktreePath: nextRecord.worktreePath,
    attachedAt,
    ...(nextRecord.branchName ? { branchName: nextRecord.branchName } : {}),
    ...(nextRecord.worktreeName ? { worktreeName: nextRecord.worktreeName } : {}),
  }
}

export function getBeadsRuntimeStatusSnapshot(args: {
  directory: string
  sessionID: string
}): BeadsRuntimeStatusSnapshot {
  const state = readBoulderState(args.directory)
  if (!state || !state.session_ids.includes(args.sessionID) || !state.bead_id) {
    return { activeContinuation: false }
  }

  const registry = pruneInactiveBeadsRuntimeAttachments(
    state.bead_worktree_path ?? state.worktree_path ?? args.directory,
  )
  const record = registry[state.bead_id]

  return {
    activeContinuation: !getPlanProgress(state.active_plan).isComplete,
    beadID: state.bead_id,
    sourceCommand: state.bead_source_command,
    worktreePath: state.bead_worktree_path ?? state.worktree_path,
    ...(record?.branchName ? { branchName: record.branchName } : {}),
    ...(record?.worktreeName ? { worktreeName: record.worktreeName } : {}),
  }
}

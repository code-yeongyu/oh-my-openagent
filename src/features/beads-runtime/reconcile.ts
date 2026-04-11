import { applyBeadsRuntimeToBoulderState, readBoulderState, writeBoulderState } from "../boulder-state"
import { readBeadsRuntimeInProgress, readBeadsRuntimeIssueDetails, readBeadsRuntimeReady } from "./br-cli"
import type { BeadsRuntimeCommandRunner } from "./br-command-runner"
import { resolveBeadsRuntimeCommandCwd } from "./br-command-cwd"
import {
  createDetachedBeadsReconcileState,
  createFailedBeadsReconcileState,
  createPendingBeadsReconcileState,
  createReconciledBeadsReconcileState,
  createStaleBeadsReconcileState,
  type BeadsRuntimeReconcileState,
} from "./reconcile-state"
import { createBeadsRuntimeAttachError } from "./errors"

export interface BeadsRuntimeReconcileResult {
  beadID?: string
  cwd: string
  state: BeadsRuntimeReconcileState
  lastReconciledAt?: string
}

function getRecordedBeadID(directory: string): string | undefined {
  const beadID = readBoulderState(directory)?.bead_id?.trim()
  return beadID ? beadID : undefined
}

export async function reconcileBeadsRuntimeState(args: {
  directory: string
  beadID?: string
  worktreePath?: string
  runner?: BeadsRuntimeCommandRunner
  requireDetails?: boolean
}): Promise<BeadsRuntimeReconcileResult> {
  const currentState = readBoulderState(args.directory)
  const recordedBeadID = args.beadID?.trim() || currentState?.bead_id?.trim()
  const cwd = resolveBeadsRuntimeCommandCwd({
    directory: args.directory,
    state: currentState,
    worktreePath: args.worktreePath,
  })

  if (!recordedBeadID) {
    return {
      cwd,
      state: createDetachedBeadsReconcileState(),
    }
  }

  const inProgress = await readBeadsRuntimeInProgress({ cwd, runner: args.runner })
  const refreshedBeadID = getRecordedBeadID(args.directory)
  if (refreshedBeadID && refreshedBeadID !== recordedBeadID) {
    throw createBeadsRuntimeAttachError({
      message: "beads runtime reconciliation refused to trust stale in-memory bead metadata after the ledger was re-read",
      details: {
        directory: args.directory,
        expectedBeadID: recordedBeadID,
        actualBeadID: refreshedBeadID,
        cwd,
      },
    })
  }

  const checkedAt = new Date().toISOString()
  const inProgressIssue = inProgress.issues.find((issue) => issue.id === recordedBeadID)
  if (!inProgressIssue) {
    return {
      beadID: recordedBeadID,
      cwd,
      state: createStaleBeadsReconcileState(
        `bead ${recordedBeadID} is no longer present in br list --status in_progress --json`,
        checkedAt,
      ),
    }
  }

  if (args.requireDetails) {
    const details = await readBeadsRuntimeIssueDetails({ beadID: recordedBeadID, cwd, runner: args.runner })
    if (!details.some((issue) => issue.id === recordedBeadID)) {
      return {
        beadID: recordedBeadID,
        cwd,
        state: createFailedBeadsReconcileState(
          `beads runtime expected br show ${recordedBeadID} --json to include the requested bead`,
          checkedAt,
        ),
      }
    }
  }

  const ready = await readBeadsRuntimeReady({ cwd, runner: args.runner })
  const lastReconciledAt = checkedAt
  const nextState = ready.some((issue) => issue.id === recordedBeadID)
    ? createPendingBeadsReconcileState(checkedAt)
    : createReconciledBeadsReconcileState(checkedAt)

  const stateAfterRead = readBoulderState(args.directory)
  if (stateAfterRead?.bead_id?.trim() === recordedBeadID) {
    writeBoulderState(
      args.directory,
      applyBeadsRuntimeToBoulderState(stateAfterRead, {
        beadID: recordedBeadID,
        worktreePath: cwd,
        lastReconciledAt,
      }),
    )
  }

  return {
    beadID: recordedBeadID,
    cwd,
    state: nextState,
    lastReconciledAt,
  }
}

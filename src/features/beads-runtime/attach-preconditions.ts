import { getPlanProgress, readBoulderState } from "../boulder-state"
import { readBeadsRuntimeInProgress } from "./br-cli"
import type { BeadsRuntimeCommandRunner } from "./br-command-runner"
import { createBeadsRuntimeAttachError } from "./errors"

export function getContinuationStateOrThrow(directory: string, sessionID: string) {
  const state = readBoulderState(directory)
  if (!state || getPlanProgress(state.active_plan).isComplete) {
    throw createBeadsRuntimeAttachError({
      message: "beads runtime attach requires an active top-level continuation in boulder state",
      details: { directory, sessionID },
    })
  }

  if (!state.session_ids.includes(sessionID)) {
    throw createBeadsRuntimeAttachError({
      message: "beads runtime attach only applies to the tracked continuation session lineage",
      details: { directory, sessionID },
    })
  }

  return state
}

export async function assertBeadIsClaimedInProgress(args: {
  beadID: string
  cwd: string
  runner: BeadsRuntimeCommandRunner
}): Promise<void> {
  const issues = await readBeadsRuntimeInProgress({
    cwd: args.cwd,
    runner: args.runner,
  })

  if (!issues.issues.some((issue) => issue.id === args.beadID)) {
    throw createBeadsRuntimeAttachError({
      message: `beads runtime attach requires bead ${args.beadID} to be claimed and currently in_progress`,
      details: { beadID: args.beadID, cwd: args.cwd },
    })
  }
}

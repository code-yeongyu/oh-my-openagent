import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { readBoulderState } from "../features/boulder-state"
import { log } from "../shared"

const BEADS_ARTIFACTS_DIR = join(".beads", "artifacts")

export function writeBeadCheckpoint(directory: string, sessionID: string): void {
  try {
    const state = readBoulderState(directory)
    if (!state) {
      return
    }

    const artifactsDir = join(directory, BEADS_ARTIFACTS_DIR)
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true })
    }

    const checkpointData = {
      session_id: sessionID,
      cleared_at: new Date().toISOString(),
      active_plan: state.active_plan ?? null,
      plan_name: state.plan_name ?? null,
      session_ids: state.session_ids ?? [],
      task_sessions: state.task_sessions ?? {},
      worktree_path: state.worktree_path ?? null,
      bead_id: state.bead_id ?? null,
      bead_source_command: state.bead_source_command ?? null,
      bead_worktree_path: state.bead_worktree_path ?? state.worktree_path ?? null,
      bead_last_reconciled_at: state.bead_last_reconciled_at ?? null,
    }

    const checkpointPath = join(artifactsDir, `checkpoint-${sessionID}.json`)
    writeFileSync(checkpointPath, JSON.stringify(checkpointData, null, 2), "utf-8")
    log("[bead-checkpoint] Written checkpoint before boulder state clear", {
      sessionID,
      checkpointPath,
    })
  } catch (error) {
    log("[bead-checkpoint] Failed to write checkpoint", {
      sessionID,
      error: String(error),
    })
  }
}

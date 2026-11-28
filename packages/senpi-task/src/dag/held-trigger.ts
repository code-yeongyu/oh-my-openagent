// The write of a held trigger (#11381): a turn a finished child started on its own while the user had
// stopped its run is held by the fence, and recorded on its node here. The record's reducer, clearing
// and wording live in `held-trigger-record.ts`.
import { log } from "@oh-my-opencode/utils"

import { dagDiagnosticAddedEvent } from "./events"
import type { DagRunRecordV1 } from "./manager"
import { DagNodeControlError } from "./node-control-context"
import { appendWhileStopped } from "./paused-controls"
import type { DagSchedulerOptions } from "./scheduler"
import type { DagNodeId } from "./types"

// The manager learns of the turn from the child's own start; no send asked for it and no wake record
// names a source, so this is all that is known of what fired.
export const UNSOLICITED_TURN_CAUSE = "a turn started that no send asked for"

/**
 * Records a held trigger through the one write to a user-stopped run (`appendWhileStopped`): written
 * only while the run is still stopped by the same Stop and no other live process holds it. Otherwise
 * nothing is written; the turn stays held either way (the fence decided that on its own read).
 */
export function recordHeldTrigger(
  options: Omit<DagSchedulerOptions, "initialRecord">,
  run: DagRunRecordV1,
  nodeId: DagNodeId,
  taskId: string,
): void {
  const at = new Date((options.now ?? Date.now)()).toISOString()
  const message = `held while stopped: task ${taskId} started a turn that no send asked for`
  const diagnostic = {
    kind: "node_flag" as const,
    nodeId,
    message,
    at,
    heldTrigger: { taskId, cause: UNSOLICITED_TURN_CAUSE },
  }
  try {
    appendWhileStopped({ ...options, initialRecord: run }, run, dagDiagnosticAddedEvent({ diagnostic }))
  } catch (error) {
    if (!(error instanceof DagNodeControlError)) throw error
    log("senpi-task a held trigger was not recorded on its run", {
      runId: run.runId,
      nodeId,
      taskId,
      reason: error.message,
    })
  }
}

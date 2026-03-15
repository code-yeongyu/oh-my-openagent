import type { PluginInput } from "@opencode-ai/plugin"
import { appendSessionId, getPlanProgress, readBoulderState } from "../../features/boulder-state"
import type { BoulderState, PlanProgress } from "../../features/boulder-state"
import { subagentSessions } from "../../features/claude-code-session-state"
import { isSessionInBoulderLineage } from "./boulder-session-lineage"

export async function resolveActiveBoulderSession(input: {
  client: PluginInput["client"]
  directory: string
  sessionID: string
}): Promise<{
  boulderState: BoulderState
  progress: PlanProgress
  appendedSession: boolean
} | null> {
  const boulderState = readBoulderState(input.directory)
  if (!boulderState) {
    return null
  }

  const progress = getPlanProgress(boulderState.active_plan)
  if (progress.isComplete) {
    return { boulderState, progress, appendedSession: false }
  }

  if (boulderState.session_ids.includes(input.sessionID)) {
    return { boulderState, progress, appendedSession: false }
  }

  if (!subagentSessions.has(input.sessionID)) {
    return null
  }

  const belongsToActiveBoulder = await isSessionInBoulderLineage({
    client: input.client,
    sessionID: input.sessionID,
    boulderSessionIDs: boulderState.session_ids,
  })
  if (!belongsToActiveBoulder) {
    return null
  }

  const updatedBoulderState = appendSessionId(input.directory, input.sessionID)
  if (!updatedBoulderState?.session_ids.includes(input.sessionID)) {
    return null
  }

  return {
    boulderState: updatedBoulderState,
    progress,
    appendedSession: true,
  }
}

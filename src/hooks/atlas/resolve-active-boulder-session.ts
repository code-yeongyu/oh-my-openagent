import type { PluginInput } from "@opencode-ai/plugin"
import { getPlanProgress, readBoulderState, resolveBoulderPlanPath } from "../../features/boulder-state"
import type { BoulderState, PlanProgress } from "../../features/boulder-state"

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

  if (!boulderState.session_ids.includes(input.sessionID)) {
    return null
  }

  const progress = getPlanProgress(resolveBoulderPlanPath(input.directory, boulderState))
  if (progress.isComplete) {
    return { boulderState, progress, appendedSession: false }
  }

  return { boulderState, progress, appendedSession: false }
}

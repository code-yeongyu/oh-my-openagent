import { readBoulderState } from "./read-state"
import { nowIsoString } from "./shared"
import { writeBoulderState } from "./write-state"

/** Records that a work's completion nudge was sent, in the boulder file, so it survives session-state pruning and restarts (#4744). */
export function markCompletionNudged(directory: string, workId: string, nudgedAt: string = nowIsoString()): boolean {
  const state = readBoulderState(directory)
  if (!state) return false
  const work = state.works?.[workId]
  if (!work) return false
  if (work.completion_nudged_at !== undefined) return true
  work.completion_nudged_at = nudgedAt
  return writeBoulderState(directory, state).ok
}

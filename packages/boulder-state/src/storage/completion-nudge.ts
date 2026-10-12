import type { BoulderState } from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { nowIsoString } from "./shared"
import { writeBoulderState } from "./write-state"

/** Records that a work's completion nudge was sent, in the boulder file, so it survives session-state pruning and restarts (#4744). */
export function markCompletionNudged(directory: string, workId: string, nudgedAt: string = nowIsoString()): boolean {
  const state = readBoulderState(directory)
  if (!state) return false
  const works = getBoulderWorks(state)
  const work = works.find((candidate) => candidate.work_id === workId)
  if (!work) return false
  if (work.completion_nudged_at !== undefined) return true
  // A legacy mirror-only state carries its single work implicitly; recording the marker
  // materializes the works map exactly like selectActiveWork/reconcileStaleWorks already do.
  const activeWorkId = state.active_work_id ?? (works.length === 1 ? workId : undefined)
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: Object.fromEntries(
      works.map((candidate) => [
        candidate.work_id,
        candidate.work_id === workId ? { ...candidate, completion_nudged_at: nudgedAt } : candidate,
      ]),
    ),
    ...(activeWorkId !== undefined ? { active_work_id: activeWorkId } : {}),
  }
  return writeBoulderState(directory, nextState).ok
}

import { log } from "../../shared/logger"

import { HOOK_NAME, MAX_STAGNATION_COUNT } from "./constants"
import type { ContinuationProgressUpdate } from "./session-state"

export function shouldStopForStagnation(args: {
  sessionID: string
  incompleteCount: number
  progressUpdate: ContinuationProgressUpdate
}): boolean {
  const { sessionID, incompleteCount, progressUpdate } = args

  if (progressUpdate.hasProgressed) {
    log(`[${HOOK_NAME}] Progress detected: reset stagnation count`, {
      sessionID,
      previousIncompleteCount: progressUpdate.previousIncompleteCount,
      previousStagnationCount: progressUpdate.previousStagnationCount,
      incompleteCount,
      progressSource: progressUpdate.progressSource,
      recoveredFromStagnationStop: progressUpdate.previousStagnationCount >= MAX_STAGNATION_COUNT,
    })
  }

  if (progressUpdate.stagnationCount < MAX_STAGNATION_COUNT) {
    return false
  }

  log(`[${HOOK_NAME}] Skipped: todo continuation stagnated`, {
    sessionID,
    incompleteCount,
    previousIncompleteCount: progressUpdate.previousIncompleteCount,
    stagnationCount: progressUpdate.stagnationCount,
    maxStagnationCount: MAX_STAGNATION_COUNT,
  })
  return true
}

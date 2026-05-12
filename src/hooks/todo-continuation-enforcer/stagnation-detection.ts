import { log } from "../../shared/logger"

import { HOOK_NAME, MAX_STAGNATION_COUNT } from "./constants"
import type { ContinuationProgressUpdate } from "./session-state"

export function shouldStopForStagnation(args: {
  sessionID: string
  incompleteCount: number
  progressUpdate: ContinuationProgressUpdate
  maxStagnationCount?: number
}): boolean {
  const { sessionID, incompleteCount, progressUpdate, maxStagnationCount: configMaxStagnationCount } = args
  const effectiveMax = configMaxStagnationCount ?? MAX_STAGNATION_COUNT

  if (progressUpdate.hasProgressed) {
    log(`[${HOOK_NAME}] Progress detected: reset stagnation count`, {
      sessionID,
      previousIncompleteCount: progressUpdate.previousIncompleteCount,
      previousStagnationCount: progressUpdate.previousStagnationCount,
      incompleteCount,
      progressSource: progressUpdate.progressSource,
      recoveredFromStagnationStop: progressUpdate.previousStagnationCount >= effectiveMax,
    })
  }

  if (progressUpdate.stagnationCount < effectiveMax) {
    return false
  }

  log(`[${HOOK_NAME}] Skipped: todo continuation stagnated`, {
    sessionID,
    incompleteCount,
    previousIncompleteCount: progressUpdate.previousIncompleteCount,
    stagnationCount: progressUpdate.stagnationCount,
    maxStagnationCount: effectiveMax,
  })
  return true
}

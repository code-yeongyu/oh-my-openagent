import pc from "picocolors"
import type { RunContext } from "./types"
import type { EventState } from "./events"
import { checkCompletionConditions } from "./completion"

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_REQUIRED_CONSECUTIVE = 3
const ERROR_GRACE_CYCLES = 3
const MIN_STABILIZATION_MS = 10_000

export interface PollOptions {
  pollIntervalMs?: number
  requiredConsecutive?: number
  minStabilizationMs?: number
}

export async function pollForCompletion(
  ctx: RunContext,
  eventState: EventState,
  abortController: AbortController,
  options: PollOptions = {}
): Promise<number> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const requiredConsecutive =
    options.requiredConsecutive ?? DEFAULT_REQUIRED_CONSECUTIVE
  const minStabilizationMs =
    options.minStabilizationMs ?? MIN_STABILIZATION_MS
  let consecutiveCompleteChecks = 0
  let errorCycleCount = 0
  let firstWorkTimestamp: number | null = null

  while (!abortController.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))

    // ERROR CHECK FIRST — errors must not be masked by other gates
    if (eventState.mainSessionError) {
      errorCycleCount++
      if (errorCycleCount >= ERROR_GRACE_CYCLES) {
        console.error(
          pc.red(`\n\nSession ended with error: ${eventState.lastError}`)
        )
        console.error(
          pc.yellow("Check if todos were completed before the error.")
        )
        return 1
      }
      // Continue polling during grace period to allow recovery
      continue
    } else {
      // Reset error counter when error clears (recovery succeeded)
      errorCycleCount = 0
    }

    if (!eventState.mainSessionIdle) {
      consecutiveCompleteChecks = 0
      continue
    }

    if (eventState.currentTool !== null) {
      consecutiveCompleteChecks = 0
      continue
    }

    if (!eventState.hasReceivedMeaningfulWork) {
      consecutiveCompleteChecks = 0
      continue
    }

    // Track when first meaningful work was received
    if (firstWorkTimestamp === null) {
      firstWorkTimestamp = Date.now()
    }

    // Don't check completion during stabilization period
    if (Date.now() - firstWorkTimestamp < minStabilizationMs) {
      consecutiveCompleteChecks = 0
      continue
    }

    const shouldExit = await checkCompletionConditions(ctx)
    if (shouldExit) {
      consecutiveCompleteChecks++
      if (consecutiveCompleteChecks >= requiredConsecutive) {
        console.log(pc.green("\n\nAll tasks completed."))
        return 0
      }
    } else {
      consecutiveCompleteChecks = 0
    }
  }

  return 130
}

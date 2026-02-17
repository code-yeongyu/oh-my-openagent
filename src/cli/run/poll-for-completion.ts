import pc from "picocolors"
import type { RunContext } from "./types"
import type { EventState } from "./events"
import { checkCompletionConditions } from "./completion"
import { normalizeSDKResponse } from "../../shared"

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_REQUIRED_CONSECUTIVE = 1
const ERROR_GRACE_CYCLES = 3
const MIN_STABILIZATION_MS = 0

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
  const pollStartTimestamp = Date.now()

  while (!abortController.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))

    if (abortController.signal.aborted) {
      return 130
    }

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

    const mainSessionStatus = await getMainSessionStatus(ctx)
    if (mainSessionStatus === "busy" || mainSessionStatus === "retry") {
      eventState.mainSessionIdle = false
    } else if (mainSessionStatus === "idle") {
      eventState.mainSessionIdle = true
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
      if (minStabilizationMs <= 0) {
        consecutiveCompleteChecks = 0
        continue
      }

      if (Date.now() - pollStartTimestamp < minStabilizationMs) {
        consecutiveCompleteChecks = 0
        continue
      }
      consecutiveCompleteChecks = 0
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
      if (abortController.signal.aborted) {
        return 130
      }

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

async function getMainSessionStatus(
  ctx: RunContext
): Promise<"idle" | "busy" | "retry" | null> {
  try {
    const statusesRes = await ctx.client.session.status({
      query: { directory: ctx.directory },
    })
    const statuses = normalizeSDKResponse(
      statusesRes,
      {} as Record<string, { type?: string }>
    )
    const status = statuses[ctx.sessionID]?.type
    if (status === "idle" || status === "busy" || status === "retry") {
      return status
    }
    return null
  } catch {
    return null
  }
}

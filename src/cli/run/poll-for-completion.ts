import pc from "picocolors"
import type { RunContext } from "./types"
import type { EventState } from "./events"
import { checkBeadsCompletionGate } from "./beads-completion-gate"
import {
  createMeaningfulWorkStabilizationState,
  shouldDelayCompletionCheck,
} from "./meaningful-work-stabilization"
import { probeMainSessionStatus } from "./session-status-probe"

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_REQUIRED_CONSECUTIVE = 1
const ERROR_GRACE_CYCLES = 3
const MIN_STABILIZATION_MS = 1_000
const DEFAULT_EVENT_WATCHDOG_MS = 30_000 // 30 seconds
const DEFAULT_SECONDARY_MEANINGFUL_WORK_TIMEOUT_MS = 60_000 // 60 seconds

export interface PollOptions {
  pollIntervalMs?: number
  requiredConsecutive?: number
  minStabilizationMs?: number
  eventWatchdogMs?: number
  secondaryMeaningfulWorkTimeoutMs?: number
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
  const rawMinStabilizationMs =
    options.minStabilizationMs ?? MIN_STABILIZATION_MS
  const minStabilizationMs =
    rawMinStabilizationMs > 0 ? rawMinStabilizationMs : MIN_STABILIZATION_MS
  const eventWatchdogMs =
    options.eventWatchdogMs ?? DEFAULT_EVENT_WATCHDOG_MS
  const secondaryMeaningfulWorkTimeoutMs =
    options.secondaryMeaningfulWorkTimeoutMs ??
    DEFAULT_SECONDARY_MEANINGFUL_WORK_TIMEOUT_MS
  let consecutiveCompleteChecks = 0
  let errorCycleCount = 0
  const stabilizationState = createMeaningfulWorkStabilizationState()

  while (!abortController.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))

    if (abortController.signal.aborted) {
      return 130
    }

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
      continue
    } else {
      errorCycleCount = 0
    }

    await probeMainSessionStatus({
      ctx,
      eventState,
      eventWatchdogMs,
    })

    if (!eventState.mainSessionIdle) {
      consecutiveCompleteChecks = 0
      continue
    }

    if (eventState.currentTool !== null) {
      consecutiveCompleteChecks = 0
      continue
    }

    if (
      await shouldDelayCompletionCheck({
        ctx,
        eventState,
        state: stabilizationState,
        minStabilizationMs,
        secondaryMeaningfulWorkTimeoutMs,
      })
    ) {
      consecutiveCompleteChecks = 0
      continue
    }

    const shouldExit = await checkBeadsCompletionGate(ctx)
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

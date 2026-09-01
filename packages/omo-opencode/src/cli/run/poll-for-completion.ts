import pc from "picocolors"
import type { RunContext } from "./types"
import type { EventState } from "./events"
import { checkCompletionConditions } from "./completion"
import { isRecord, normalizeSDKResponse } from "../../shared"

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_REQUIRED_CONSECUTIVE = 1
const ERROR_GRACE_CYCLES = 3
const MIN_STABILIZATION_MS = 1_000
const DEFAULT_EVENT_WATCHDOG_MS = 30_000 // 30 seconds
const DEFAULT_SECONDARY_MEANINGFUL_WORK_TIMEOUT_MS = 60_000 // 60 seconds

type SessionStatusMap = Record<string, { type?: string }>

function isIncompleteTodo(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  const status = value.status
  return status !== "completed" && status !== "cancelled"
}

export interface PollOptions {
  pollIntervalMs?: number
  requiredConsecutive?: number
  minStabilizationMs?: number
  eventWatchdogMs?: number
  secondaryMeaningfulWorkTimeoutMs?: number
  requireMeaningfulWork?: boolean
  /** Injectable clock (default Date.now). Tests drive a virtual clock to assert timing causality deterministically. */
  now?: () => number
  /** Injectable poll delay (default real setTimeout). Tests advance the virtual clock here instead of sleeping. */
  sleep?: (ms: number) => Promise<void>
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
  const requireMeaningfulWork = options.requireMeaningfulWork ?? false
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let consecutiveCompleteChecks = 0
  let errorCycleCount = 0
  let firstWorkTimestamp: number | null = null
  let secondaryTimeoutChecked = false
  const pollStartTimestamp = now()

  while (!abortController.signal.aborted) {
    await sleep(pollIntervalMs)

    if (abortController.signal.aborted) {
      return 130
    }

    if (eventState.mainSessionError) {
      // A session.error is only terminal while the session stays idle:
      // runtime fallback rearms the session (status "busy"/"retry") after
      // retryable errors, so a live recovery clears the latch (#3745).
      const statusDuringError = await getMainSessionStatus(ctx)
      if (statusDuringError === "busy" || statusDuringError === "retry") {
        eventState.mainSessionError = false
        eventState.mainSessionIdle = false
        errorCycleCount = 0
        continue
      }
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

    let mainSessionStatus: "idle" | "busy" | "retry" | null = null
    if (eventState.lastEventTimestamp !== null) {
      const timeSinceLastEvent = now() - eventState.lastEventTimestamp
      if (timeSinceLastEvent > eventWatchdogMs) {
        console.log(
          pc.yellow(
            `\n  No events for ${Math.round(
              timeSinceLastEvent / 1000
            )}s, verifying session status...`
          )
        )

        mainSessionStatus = await getMainSessionStatus(ctx)
        if (mainSessionStatus === "idle") {
          eventState.mainSessionIdle = true
        } else if (mainSessionStatus === "busy" || mainSessionStatus === "retry") {
          eventState.mainSessionIdle = false
        }

        eventState.lastEventTimestamp = now()
      }
    }

    if (mainSessionStatus === null) {
      mainSessionStatus = await getMainSessionStatus(ctx)
    }
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
      if (now() - pollStartTimestamp < minStabilizationMs) {
        consecutiveCompleteChecks = 0
        continue
      }

      if (requireMeaningfulWork) {
        if (now() - pollStartTimestamp <= secondaryMeaningfulWorkTimeoutMs) {
          consecutiveCompleteChecks = 0
          continue
        }

        const hasActiveWork = await hasActiveSessionWork(ctx)
        if (hasActiveWork) {
          consecutiveCompleteChecks = 0
          continue
        }

        console.error(
          pc.red("\n\nSession never produced assistant output, tool activity, or reasoning after the prompt started.")
        )
        return 1
      }

      if (now() - pollStartTimestamp > secondaryMeaningfulWorkTimeoutMs && !secondaryTimeoutChecked) {
        secondaryTimeoutChecked = true
        const hasActiveWork = await hasActiveSessionWork(ctx)

        if (hasActiveWork) {
          eventState.hasReceivedMeaningfulWork = true
          console.log(
            pc.yellow(
              `\n  No meaningful work events for ${Math.round(
                secondaryMeaningfulWorkTimeoutMs / 1000
              )}s but session has active work - assuming in progress`
            )
          )
        }
      }
    } else {
      if (firstWorkTimestamp === null) {
        firstWorkTimestamp = now()
      }

      if (now() - firstWorkTimestamp < minStabilizationMs) {
        consecutiveCompleteChecks = 0
        continue
      }
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

async function hasActiveSessionWork(ctx: RunContext): Promise<boolean> {
  const childrenRes = await ctx.client.session.children({
    path: { id: ctx.sessionID },
    query: { directory: ctx.directory },
  })
  const children = normalizeSDKResponse<unknown[]>(childrenRes, [])
  const todosRes = await ctx.client.session.todo({
    path: { id: ctx.sessionID },
    query: { directory: ctx.directory },
  })
  const todos = normalizeSDKResponse<unknown[]>(todosRes, [])

  const hasActiveChildren = Array.isArray(children) && children.length > 0
  const hasActiveTodos = Array.isArray(todos) && todos.some(isIncompleteTodo)
  return hasActiveChildren || hasActiveTodos
}

async function getMainSessionStatus(
  ctx: RunContext
): Promise<"idle" | "busy" | "retry" | null> {
  try {
    const statusesRes = await ctx.client.session.status({
      query: { directory: ctx.directory },
    })
    const statuses = normalizeSDKResponse<SessionStatusMap>(statusesRes, {})
    if (!(ctx.sessionID in statuses)) {
      return "idle"
    }
    const status = statuses[ctx.sessionID]?.type
    if (status === "idle" || status === "busy" || status === "retry") {
      return status
    }
    return null
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}

import pc from "picocolors"

import type { EventState } from "./events"
import type { RunContext } from "./types"
import { normalizeSDKResponse } from "../../shared"

export interface MeaningfulWorkStabilizationState {
  firstWorkTimestamp: number | null
  pollStartTimestamp: number
  secondaryTimeoutChecked: boolean
}

export function createMeaningfulWorkStabilizationState(
  pollStartTimestamp = Date.now(),
): MeaningfulWorkStabilizationState {
  return {
    firstWorkTimestamp: null,
    pollStartTimestamp,
    secondaryTimeoutChecked: false,
  }
}

export async function shouldDelayCompletionCheck(args: {
  ctx: RunContext
  eventState: EventState
  state: MeaningfulWorkStabilizationState
  minStabilizationMs: number
  secondaryMeaningfulWorkTimeoutMs: number
}): Promise<boolean> {
  const {
    ctx,
    eventState,
    state,
    minStabilizationMs,
    secondaryMeaningfulWorkTimeoutMs,
  } = args
  const now = Date.now()

  if (!eventState.hasReceivedMeaningfulWork) {
    if (now - state.pollStartTimestamp < minStabilizationMs) {
      return true
    }

    if (
      now - state.pollStartTimestamp > secondaryMeaningfulWorkTimeoutMs
      && !state.secondaryTimeoutChecked
    ) {
      state.secondaryTimeoutChecked = true
      const hasActiveWork = await hasActiveSessionWork(ctx)

      if (hasActiveWork) {
        eventState.hasReceivedMeaningfulWork = true
        console.log(
          pc.yellow(
            `\n  No meaningful work events for ${Math.round(
              secondaryMeaningfulWorkTimeoutMs / 1000,
            )}s but session has active work - assuming in progress`,
          ),
        )
      }
    }

    return false
  }

  if (state.firstWorkTimestamp === null) {
    state.firstWorkTimestamp = now
    return true
  }

  return now - state.firstWorkTimestamp < minStabilizationMs
}

async function hasActiveSessionWork(ctx: RunContext): Promise<boolean> {
  const childrenRes = await ctx.client.session.children({
    path: { id: ctx.sessionID },
    query: { directory: ctx.directory },
  })
  const children = normalizeSDKResponse(childrenRes, [] as unknown[])
  const todosRes = await ctx.client.session.todo({
    path: { id: ctx.sessionID },
    query: { directory: ctx.directory },
  })
  const todos = normalizeSDKResponse(todosRes, [] as unknown[])

  const hasActiveChildren = Array.isArray(children) && children.length > 0
  const hasActiveTodos =
    Array.isArray(todos)
    && todos.some(
      (todo: unknown) =>
        (todo as { status?: string })?.status !== "completed"
        && (todo as { status?: string })?.status !== "cancelled",
    )

  return hasActiveChildren || hasActiveTodos
}

import pc from "picocolors"

import type { EventState } from "./events"
import type { RunContext } from "./types"
import { normalizeSDKResponse } from "../../shared"

export type MainSessionStatus = "idle" | "busy" | "retry" | null

export async function probeMainSessionStatus(args: {
  ctx: RunContext
  eventState: EventState
  eventWatchdogMs: number
}): Promise<MainSessionStatus> {
  const { ctx, eventState, eventWatchdogMs } = args
  let mainSessionStatus: MainSessionStatus = null

  if (eventState.lastEventTimestamp !== null) {
    const timeSinceLastEvent = Date.now() - eventState.lastEventTimestamp
    if (timeSinceLastEvent > eventWatchdogMs) {
      console.log(
        pc.yellow(
          `\n  No events for ${Math.round(timeSinceLastEvent / 1000)}s, verifying session status...`,
        ),
      )

      mainSessionStatus = await getMainSessionStatus(ctx)
      eventState.lastEventTimestamp = Date.now()
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

  return mainSessionStatus
}

async function getMainSessionStatus(ctx: RunContext): Promise<MainSessionStatus> {
  try {
    const statusesRes = await ctx.client.session.status({
      query: { directory: ctx.directory },
    })
    const statuses = normalizeSDKResponse(
      statusesRes,
      {} as Record<string, { type?: string }>,
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

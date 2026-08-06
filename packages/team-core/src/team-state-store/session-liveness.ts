import type { TeamSessionContext } from "../session-client"
import type { RuntimeState } from "../types"
import { isSessionNotFoundError, toError } from "./error-normalization"

export interface WorkerLiveness {
  readonly name: string
  readonly wasSpawned: boolean
  readonly stillAlive: boolean
}

export async function sessionExists(
  ctx: TeamSessionContext,
  sessionId: string,
): Promise<boolean> {
  try {
    const response = await ctx.client.session.get({ path: { id: sessionId } })

    if (response.error != null) {
      if (isSessionNotFoundError(response.error)) return false
      throw toError(response.error)
    }

    return response.data != null
  } catch (error) {
    if (isSessionNotFoundError(error)) return false
    throw error
  }
}

export async function inspectWorkerMembers(
  ctx: TeamSessionContext,
  runtimeState: RuntimeState,
): Promise<WorkerLiveness[]> {
  const workerMembers = runtimeState.members.filter((member) => member.agentType !== "leader")

  return await Promise.all(workerMembers.map(async (member) => {
    if (member.status === "errored") {
      return { name: member.name, wasSpawned: true, stillAlive: false }
    }

    if (member.sessionId === undefined) {
      return { name: member.name, wasSpawned: false, stillAlive: true }
    }

    const stillAlive = await sessionExists(ctx, member.sessionId)
    return { name: member.name, wasSpawned: true, stillAlive }
  }))
}

import { log } from "../../shared/logger"
import type { ExecutorContext, ParentContext } from "./executor-types"

export interface SyncSpawnReservation {
  readonly spawnContext: {
    readonly rootSessionID: string
    readonly parentDepth: number
    readonly childDepth: number
  }
  readonly reservation: Awaited<ReturnType<ExecutorContext["manager"]["reserveSubagentSpawn"]>> | undefined
}

export async function reserveSyncSubagentSpawn(
  executorCtx: Pick<ExecutorContext, "manager">,
  parentContext: Pick<ParentContext, "sessionID">
): Promise<SyncSpawnReservation> {
  const { manager } = executorCtx
  const reservation = typeof manager?.reserveSubagentSpawn === "function"
    ? await manager.reserveSubagentSpawn(parentContext.sessionID)
    : undefined

  if (reservation?.spawnContext) {
    return {
      spawnContext: reservation.spawnContext,
      reservation,
    }
  }

  if (typeof manager?.assertCanSpawn === "function") {
    return {
      spawnContext: await manager.assertCanSpawn(parentContext.sessionID),
      reservation,
    }
  }

  log(
    "[task] WARNING: BackgroundManager has no spawn enforcement methods (reserveSubagentSpawn / assertCanSpawn). " +
    "Depth limits cannot be enforced for this task. This indicates an old SDK or a misconfiguration.",
    { parentSessionID: parentContext.sessionID }
  )
  return {
    spawnContext: {
      rootSessionID: parentContext.sessionID,
      parentDepth: 0,
      childDepth: 1,
    },
    reservation,
  }
}

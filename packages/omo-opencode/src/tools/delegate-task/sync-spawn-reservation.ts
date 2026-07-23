import { requireSpawnCallerIdentity } from "../../features/background-agent/subagent-spawn-limits"
import type { ExecutorContext, ParentContext } from "./executor-types"

export class SyncSpawnAdmissionUnavailableError extends Error {
  readonly name = "SyncSpawnAdmissionUnavailableError"

  constructor() {
    super("Subagent spawn admission unavailable")
  }
}

export async function assertSyncSubagentSpawn(
  executorCtx: Pick<ExecutorContext, "manager">,
  parentContext: Pick<ParentContext, "sessionID" | "agent">,
  targetAgent: string,
): Promise<Awaited<ReturnType<ExecutorContext["manager"]["assertCanSpawn"]>>> {
  if (!executorCtx.manager) throw new SyncSpawnAdmissionUnavailableError()
  return executorCtx.manager.assertCanSpawn({
    parentSessionID: parentContext.sessionID,
    parentAgent: requireSpawnCallerIdentity(parentContext.agent),
    targetAgent,
  })
}

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  SENPI_TASK_LINEAGE_TASK_ID_ENV,
  type ResolveAncestry,
  type TaskAncestry,
  type TaskRecordStore,
} from "@oh-my-opencode/senpi-task"

export type StoredSpawnLineageDeps = {
  readonly store: TaskRecordStore
  readonly omoConfig: OmoConfig
  readonly env: NodeJS.ProcessEnv
}

export function createStoredSpawnLineageResolver(deps: StoredSpawnLineageDeps): ResolveAncestry {
  return (parentSessionId) => {
    const taskId = deps.env[SENPI_TASK_LINEAGE_TASK_ID_ENV]
    if (taskId === undefined) {
      return deps.env.SENPI_TASK_MEMBER === undefined
        ? rootAncestry(parentSessionId)
        : unknownAncestry(parentSessionId)
    }

    try {
      const record = deps.store.load(taskId)
      if (
        record === null
        || record.residency_state !== "resident"
        || (record.child_session_id !== undefined && record.child_session_id !== parentSessionId)
      ) return unknownAncestry(parentSessionId)

      const agentPolicy = record.agent_type === undefined ? undefined : deps.omoConfig.agents?.[record.agent_type]
      return {
        depth: record.depth,
        rootSessionId: record.root_session_id,
        lineage: "known",
        callerRole: record.spawn_role === "team_member" ? "team_member" : "worker",
        ...(agentPolicy?.max_depth === undefined ? {} : { callerMaxDepth: agentPolicy.max_depth }),
        ...(agentPolicy?.allowed_subagents === undefined ? {} : { allowedSubagents: agentPolicy.allowed_subagents }),
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return unknownAncestry(parentSessionId)
    }
  }
}

function rootAncestry(sessionId: string): TaskAncestry {
  return { depth: 0, rootSessionId: sessionId, lineage: "known", callerRole: "coordinator" }
}

function unknownAncestry(sessionId: string): TaskAncestry {
  return { depth: 0, rootSessionId: sessionId, lineage: "unknown", callerRole: "leaf" }
}

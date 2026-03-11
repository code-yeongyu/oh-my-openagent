import type { BackgroundTaskConfig } from "../../config/schema"
import type { OpencodeClient } from "./constants"

export const DEFAULT_MAX_SUBAGENT_DEPTH = 3
export const DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET = 50

export interface SubagentSpawnContext {
  rootSessionID: string
  parentDepth: number
  childDepth: number
}

export function getMaxSubagentDepth(config?: BackgroundTaskConfig): number {
  return config?.maxDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH
}

export function getMaxRootSessionSpawnBudget(config?: BackgroundTaskConfig): number {
  return config?.maxDescendants ?? DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET
}

export async function resolveSubagentSpawnContext(
  client: OpencodeClient,
  parentSessionID: string
): Promise<SubagentSpawnContext> {
  const visitedSessionIDs = new Set<string>()
  let rootSessionID = parentSessionID
  let currentSessionID = parentSessionID
  let parentDepth = 0

  while (true) {
    if (visitedSessionIDs.has(currentSessionID)) {
      throw new Error(`Detected a session parent cycle while resolving ${parentSessionID}`)
    }

    visitedSessionIDs.add(currentSessionID)

    let nextParentSessionID: string | undefined
    try {
      const response = await client.session.get({
        path: { id: currentSessionID },
      })
      if (response.error) {
        throw new Error(String(response.error))
      }

      if (!response.data) {
        throw new Error("No session data returned")
      }

      nextParentSessionID = response.data.parentID
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Subagent spawn blocked: failed to resolve session lineage for ${parentSessionID}, so background_task.maxDescendants cannot be enforced safely. ${reason}`
      )
    }

    if (!nextParentSessionID) {
      rootSessionID = currentSessionID
      break
    }

    currentSessionID = nextParentSessionID
    parentDepth += 1
  }

  return {
    rootSessionID,
    parentDepth,
    childDepth: parentDepth + 1,
  }
}

export function createSubagentDepthLimitError(input: {
  childDepth: number
  maxDepth: number
  parentSessionID: string
  rootSessionID: string
}): Error {
  const { childDepth, maxDepth, parentSessionID, rootSessionID } = input
  return new Error(
    `Subagent spawn blocked: child depth ${childDepth} exceeds background_task.maxDepth=${maxDepth}. Parent session: ${parentSessionID}. Root session: ${rootSessionID}. Continue in an existing subagent session instead of spawning another.`
  )
}

export function createSubagentDescendantLimitError(input: {
  rootSessionID: string
  descendantCount: number
  maxDescendants: number
}): Error {
  const { rootSessionID, descendantCount, maxDescendants } = input
  return new Error(
    `Subagent spawn blocked: root session ${rootSessionID} already has ${descendantCount} descendants, which meets background_task.maxDescendants=${maxDescendants}. Reuse an existing session instead of spawning another.`
  )
}

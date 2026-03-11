import type { BackgroundTaskConfig } from "../../config/schema"
import type { OpencodeClient } from "./constants"

export const DEFAULT_MAX_SUBAGENT_DEPTH = 3
export const DEFAULT_MAX_ROOT_DESCENDANTS = 50

export interface SubagentSpawnContext {
  rootSessionID: string
  parentDepth: number
  childDepth: number
}

export function getMaxSubagentDepth(config?: BackgroundTaskConfig): number {
  return config?.maxDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH
}

export function getMaxRootDescendants(config?: BackgroundTaskConfig): number {
  return config?.maxDescendants ?? DEFAULT_MAX_ROOT_DESCENDANTS
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

    const session = await client.session.get({
      path: { id: currentSessionID },
    }).catch(() => null)

    const nextParentSessionID = session?.data?.parentID
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

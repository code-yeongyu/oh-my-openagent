import type { BackgroundTaskConfig } from "../../config/schema"
import { log } from "../../shared/logger"
import type { OpencodeClient } from "./constants"

export const DEFAULT_MAX_SUBAGENT_DEPTH = 3

export interface SubagentSpawnContext {
  rootSessionID: string
  parentDepth: number
  childDepth: number
  degraded?: boolean
}

export function getMaxSubagentDepth(config?: BackgroundTaskConfig): number {
  return config?.maxDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH
}

type SessionParentLookup =
  | { ok: true; parentID?: string }
  | { ok: false; reason: string }

function describeLookupError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error
  if (error instanceof Error && error.message.length > 0) return error.message
  try {
    return JSON.stringify(error) ?? String(error)
  } catch (stringifyError) {
    if (!(stringifyError instanceof Error)) throw stringifyError
    return String(error)
  }
}

async function requestSessionParent(
  client: OpencodeClient,
  sessionID: string,
  directory?: string
): Promise<SessionParentLookup> {
  try {
    const response = await client.session.get({
      path: { id: sessionID },
      ...(directory ? { query: { directory } } : {}),
    })
    if (response.error) {
      return { ok: false, reason: describeLookupError(response.error) }
    }

    if (!response.data) {
      return { ok: false, reason: "No session data returned" }
    }

    return { ok: true, parentID: response.data.parentID }
  } catch (error) {
    return { ok: false, reason: describeLookupError(error) }
  }
}

async function fetchSessionParent(
  client: OpencodeClient,
  sessionID: string,
  directory?: string
): Promise<SessionParentLookup> {
  const scoped = await requestSessionParent(client, sessionID, directory)
  if (scoped.ok || !directory) {
    return scoped
  }

  // Session IDs are globally unique in opencode, but a directory-scoped lookup can miss a
  // session that lives in another project (remote clients connecting to `opencode serve`).
  // Retry unscoped before giving up on lineage resolution.
  return requestSessionParent(client, sessionID)
}

export async function resolveSubagentSpawnContext(
  client: OpencodeClient,
  parentSessionID: string,
  directory?: string
): Promise<SubagentSpawnContext> {
  const visitedSessionIDs = new Set<string>()
  let currentSessionID = parentSessionID
  let parentDepth = 0

  while (true) {
    if (visitedSessionIDs.has(currentSessionID)) {
      throw new Error(`Detected a session parent cycle while resolving ${parentSessionID}`)
    }

    visitedSessionIDs.add(currentSessionID)

    const lookup = await fetchSessionParent(client, currentSessionID, directory)
    if (!lookup.ok) {
      log(
        `[background-agent] Could not resolve session lineage for ${parentSessionID} ` +
        `(failed at ${currentSessionID}: ${lookup.reason}). ` +
        "Treating the parent as the root session so delegation still works; " +
        "background_task.maxDepth cannot be enforced for this spawn.",
        { parentSessionID, failedAtSessionID: currentSessionID }
      )
      return {
        rootSessionID: parentSessionID,
        parentDepth: 0,
        childDepth: 1,
        degraded: true,
      }
    }

    if (!lookup.parentID) {
      return {
        rootSessionID: currentSessionID,
        parentDepth,
        childDepth: parentDepth + 1,
      }
    }

    currentSessionID = lookup.parentID
    parentDepth += 1
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

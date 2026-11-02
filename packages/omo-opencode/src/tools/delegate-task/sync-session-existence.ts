import type { OpencodeClient } from "./types"

type SessionLookupResult = { data?: unknown; error?: unknown }

// Only a definite not-found (HTTP 404 or the SDK's NotFoundError body) counts as deleted:
// a transport blip, a 5xx or any other error must not end a live task, so those read as
// "still exists" and the normal poll bounds apply.
export function isDefiniteSessionNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("status" in error && error.status === 404) return true
  return "name" in error && error.name === "NotFoundError"
}

export async function isSyncSessionDeleted(client: OpencodeClient, sessionID: string): Promise<boolean> {
  if (typeof client.session?.get !== "function") return false
  try {
    const response: SessionLookupResult = await client.session.get({ path: { id: sessionID } })
    return isDefiniteSessionNotFound(response.error)
  } catch (error) {
    return isDefiniteSessionNotFound(error)
  }
}

export function formatDeletedSyncSessionError(sessionID: string): string {
  return `Error: Session ${sessionID} no longer exists, so this task cannot be continued. Completed sync task sessions are deleted after background_task.taskCleanupDelayMs (default 10 minutes). Start a new task with subagent_type or category instead of passing this task_id.`
}

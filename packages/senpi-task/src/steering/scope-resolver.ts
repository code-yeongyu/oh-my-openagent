import type { TaskRecord } from "../state"
import type { CallerScope } from "./types"

export type TaskLookup = {
  load(taskId: string): TaskRecord | undefined
  list(): readonly TaskRecord[]
}

export function ownsTask(sessionId: string, record: TaskRecord): boolean {
  return sessionId === record.parent_session_id || sessionId === record.root_session_id
}

function anywhere(lookup: TaskLookup, idOrName: string): TaskRecord | undefined {
  return lookup.load(idOrName) ?? lookup.list().find((record) => record.name === idOrName)
}

function within(lookup: TaskLookup, idOrName: string, sessionId: string | undefined): TaskRecord | undefined {
  if (sessionId === undefined) return undefined
  const byId = lookup.load(idOrName)
  if (byId !== undefined) return ownsTask(sessionId, byId) ? byId : undefined
  return lookup.list().find((record) => record.name === idOrName && ownsTask(sessionId, record))
}

/**
 * With a caller, only that caller's tasks resolve: an id or name outside them, or a caller without a session id,
 * resolves nothing. Without one (the engine's own callers), an id, else the first record carrying that name.
 */
export function resolveTask(lookup: TaskLookup, idOrName: string, caller?: CallerScope): TaskRecord | undefined {
  return caller === undefined ? anywhere(lookup, idOrName) : within(lookup, idOrName, caller.sessionId)
}

export function resolveTaskCallerFirst(
  lookup: TaskLookup,
  idOrName: string,
  callerSessionId: string | undefined,
): TaskRecord | undefined {
  return within(lookup, idOrName, callerSessionId) ?? anywhere(lookup, idOrName)
}

import type { V2Event } from "./context-types"

export type SessionTracker = {
  /** Feeds one host event; events it does not track, or that lack a session id, are ignored. */
  readonly observe: (event: V2Event) => void
  /** The 1.x `session.status()` map: only sessions that are not idle appear. */
  readonly statuses: () => Record<string, { type: "busy" }>
  readonly parentOf: (sessionID: string) => string | undefined
}

const EXECUTION_ENDED: ReadonlySet<string> = new Set([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

function sessionFields(event: V2Event): { sessionID: string; parentID?: string } | undefined {
  const { data } = event
  if (typeof data !== "object" || data === null) return undefined
  const { sessionID, parentID } = data as { sessionID?: unknown; parentID?: unknown }
  if (typeof sessionID !== "string") return undefined
  return typeof parentID === "string" ? { sessionID, parentID } : { sessionID }
}

/**
 * 2.x has no session status or session list on the plugin context, so busy state and the
 * parent/child links are learned from the event stream.
 */
export function createSessionTracker(): SessionTracker {
  const busy = new Set<string>()
  const parents = new Map<string, string>()

  return {
    observe(event) {
      const fields = sessionFields(event)
      if (fields === undefined) return
      if (event.type === "session.execution.started") busy.add(fields.sessionID)
      else if (EXECUTION_ENDED.has(event.type)) busy.delete(fields.sessionID)
      else if (event.type === "session.created" && fields.parentID !== undefined) parents.set(fields.sessionID, fields.parentID)
      else if (event.type === "session.deleted") {
        busy.delete(fields.sessionID)
        parents.delete(fields.sessionID)
      }
    },
    statuses: () => Object.fromEntries([...busy].map((sessionID) => [sessionID, { type: "busy" as const }])),
    parentOf: (sessionID) => parents.get(sessionID),
  }
}

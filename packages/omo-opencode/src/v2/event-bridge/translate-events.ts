import type { V2Event } from "../context-types"

export type V1Event = { readonly type: string; readonly properties: Readonly<Record<string, unknown>> }

type Fields = Readonly<Record<string, unknown>> & { readonly sessionID: string }

function fieldsOf(event: V2Event): Fields | undefined {
  const { data } = event
  if (typeof data !== "object" || data === null) return undefined
  return typeof (data as { sessionID?: unknown }).sessionID === "string" ? (data as Fields) : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function v1Error(error: unknown): { name: string; data: Record<string, unknown> } {
  const fields = typeof error === "object" && error !== null ? (error as { type?: unknown; message?: unknown; status?: unknown }) : {}
  return {
    name: str(fields.type) ?? "UnknownError",
    data: { message: str(fields.message) ?? "", ...(typeof fields.status === "number" ? { statusCode: fields.status } : {}) },
  }
}

const idle = (sessionID: string): V1Event[] => [
  { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
  { type: "session.idle", properties: { sessionID } },
]

/**
 * 1.x events for one 2.x event. 2.x never emits `session.idle`/`session.status`; they are derived
 * from the execution lifecycle, in the order 1.x produced them (error, then status, then idle).
 * `parentOf` must reflect the state before this event, because a deletion forgets the session.
 */
export function toV1Events(
  event: V2Event,
  sessions: { readonly parentOf: (sessionID: string) => string | undefined },
  now: () => number = Date.now,
): V1Event[] {
  const fields = fieldsOf(event)
  if (fields === undefined) return []
  const { sessionID } = fields

  switch (event.type) {
    case "session.execution.started":
      return [{ type: "session.status", properties: { sessionID, status: { type: "busy" } } }]
    case "session.execution.succeeded":
      return idle(sessionID)
    case "session.execution.failed":
      return [{ type: "session.error", properties: { sessionID, error: v1Error(fields.error) } }, ...idle(sessionID)]
    case "session.execution.interrupted":
      return fields.reason === "user"
        ? [{ type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError", data: { message: "Aborted" } } } }, ...idle(sessionID)]
        : idle(sessionID)
    case "session.created": {
      const location = typeof fields.location === "object" && fields.location !== null ? (fields.location as { directory?: unknown }) : {}
      const parentID = str(fields.parentID)
      const created = now()
      return [
        {
          type: "session.created",
          properties: {
            info: {
              id: sessionID,
              slug: str(fields.slug) ?? sessionID,
              projectID: str(fields.projectID) ?? "",
              directory: str(location.directory) ?? "",
              ...(parentID === undefined ? {} : { parentID }),
              title: str(fields.title) ?? "",
              version: str(fields.version) ?? "2",
              time: { created, updated: created },
            },
          },
        },
      ]
    }
    case "session.deleted": {
      const parentID = sessions.parentOf(sessionID)
      return [{ type: "session.deleted", properties: { info: { id: sessionID, ...(parentID === undefined ? {} : { parentID }) } } }]
    }
    case "session.compaction.ended":
      return [{ type: "session.compacted", properties: { sessionID } }]
    default:
      return []
  }
}

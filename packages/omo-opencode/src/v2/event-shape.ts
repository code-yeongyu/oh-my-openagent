function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export type V1Event = {
  type: string
  properties: Record<string, unknown>
}

export function toV1Event(event: unknown): V1Event {
  const record = isRecord(event) ? event : {}
  const type = typeof record.type === "string" ? record.type : "unknown"
  const data = isRecord(record.data) ? record.data : isRecord(record.properties) ? record.properties : {}
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined

  if (type === "session.created") {
    return {
      type,
      properties: {
        sessionID,
        info: {
          id: sessionID,
          parentID: data.parentID,
          title: data.title,
          metadata: data.metadata,
        },
      },
    }
  }

  if (type === "session.execution.failed") {
    return {
      type: "session.error",
      properties: { sessionID, error: data.error },
    }
  }

  if (type === "session.step.ended") {
    return {
      type: "message.updated",
      properties: {
        sessionID,
        info: {
          id: data.assistantMessageID,
          sessionID,
          role: "assistant",
          finish: data.finish,
        },
      },
    }
  }

  return { type, properties: { ...data } }
}

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

  if (type === "session.retry.scheduled") {
    const error = isRecord(data.error) ? data.error : {}
    return {
      type: "session.status",
      properties: {
        sessionID,
        status: {
          type: "retry",
          message: typeof error.message === "string" ? error.message : "",
          attempt: data.attempt,
        },
        error: data.error,
      },
    }
  }

  if (type === "session.execution.failed") {
    return {
      type: "session.error",
      properties: { sessionID, error: data.error },
    }
  }

  if (type === "session.step.started" || type === "session.step.ended") {
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

  if (type === "session.text.delta" || type === "session.reasoning.delta") {
    return { type: "message.part.delta", properties: {
      sessionID, messageID: data.assistantMessageID, field: "text", delta: data.delta,
    } }
  }
  if (type === "session.text.ended" || type === "session.reasoning.ended" || type === "session.tool.called") {
    return { type: "message.part.updated", properties: { part: {
      sessionID, messageID: data.assistantMessageID,
      type: type === "session.tool.called" ? "tool" : type === "session.reasoning.ended" ? "reasoning" : "text",
      text: data.text,
    } } }
  }

  return { type, properties: { ...data } }
}

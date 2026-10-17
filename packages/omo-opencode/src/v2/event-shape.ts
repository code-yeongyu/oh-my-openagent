function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export type V1Event = {
  type: string
  properties: Record<string, unknown>
}

// A step's model arrives on `session.step.started` and its usage on
// `session.step.ended`. V1 consumers (the preemptive-compaction token cache,
// the context-limit recovery) read both from one `message.updated`, so a
// stateful shaper remembers each assistant message's model between the two
// events. A stateless call still forwards everything the event itself carries.
export type StepModel = {
  providerID?: string
  modelID?: string
  agent?: string
}

function stepModelFrom(data: Record<string, unknown>): StepModel {
  const model = isRecord(data.model) ? data.model : {}
  return {
    providerID: typeof model.providerID === "string" ? model.providerID : undefined,
    modelID: typeof model.id === "string" ? model.id : undefined,
    agent: typeof data.agent === "string" ? data.agent : undefined,
  }
}

function stepMessageUpdated(
  type: string,
  data: Record<string, unknown>,
  sessionID: string | undefined,
  stepModels: Map<string, StepModel> | undefined,
): V1Event {
  const messageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined
  let model: StepModel | undefined
  if (type === "session.step.started") {
    model = stepModelFrom(data)
    if (stepModels && messageID) stepModels.set(messageID, model)
  } else if (stepModels && messageID) {
    model = stepModels.get(messageID)
    stepModels.delete(messageID)
  }
  const tokens = isRecord(data.tokens) ? data.tokens : undefined
  return {
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id: data.assistantMessageID,
        sessionID,
        role: "assistant",
        finish: data.finish,
        ...(model?.providerID ? { providerID: model.providerID } : {}),
        ...(model?.modelID ? { modelID: model.modelID } : {}),
        ...(model?.agent ? { agent: model.agent } : {}),
        ...(tokens ? { tokens } : {}),
      },
    },
  }
}

export function createV1EventShaper(): (event: unknown) => V1Event {
  const stepModels = new Map<string, StepModel>()
  return (event) => toV1Event(event, stepModels)
}

export function toV1Event(event: unknown, stepModels?: Map<string, StepModel>): V1Event {
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
    return stepMessageUpdated(type, data, sessionID, stepModels)
  }

  if (type === "session.step.failed") {
    const messageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined
    if (stepModels && messageID) stepModels.delete(messageID)
    return { type, properties: { ...data } }
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

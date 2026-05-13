type EventProperties = Record<string, unknown> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getEventInfo(properties: EventProperties): Record<string, unknown> | undefined {
  const info = properties?.info
  return isRecord(info) ? info : undefined
}

export function getSessionID(properties: EventProperties): string | undefined {
  const sessionID = properties?.sessionID
  if (typeof sessionID === "string" && sessionID.length > 0) return sessionID

  const sessionId = properties?.sessionId
  if (typeof sessionId === "string" && sessionId.length > 0) return sessionId

  const info = getEventInfo(properties)
  const infoSessionID = info?.sessionID
  if (typeof infoSessionID === "string" && infoSessionID.length > 0) return infoSessionID

  const infoSessionId = info?.sessionId
  if (typeof infoSessionId === "string" && infoSessionId.length > 0) return infoSessionId

  return undefined
}

export function getEventToolName(properties: EventProperties): string | undefined {
  const tool = properties?.tool
  if (typeof tool === "string" && tool.length > 0) return tool

  const name = properties?.name
  if (typeof name === "string" && name.length > 0) return name

  return undefined
}

export function getQuestionText(properties: EventProperties): string {
  const args = properties?.args
  if (!isRecord(args)) return ""

  const questions = args.questions
  if (!Array.isArray(questions) || questions.length === 0) return ""

  const firstQuestion = questions[0]
  if (!isRecord(firstQuestion)) return ""

  const questionText = firstQuestion.question
  return typeof questionText === "string" ? questionText : ""
}

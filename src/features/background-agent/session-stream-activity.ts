import { isRecord } from "../../shared"

export const SESSION_NEXT_EVENT_PREFIX = "session.next."

export interface MessagePartInfo {
  readonly id: string | undefined
  readonly sessionID: string | undefined
  readonly type: string | undefined
  readonly tool: string | undefined
  readonly input: Record<string, unknown> | undefined
  readonly state: {
    readonly status: string | undefined
    readonly input: Record<string, unknown> | undefined
  } | undefined
  readonly field: string | undefined
  readonly activityTime: Date | undefined
}

function getStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getRecordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key]
  return isRecord(value) ? value : undefined
}

function getDateField(record: Record<string, unknown> | undefined, key: string): Date | undefined {
  const value = record?.[key]
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : undefined
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value)
  if (typeof value !== "string") return undefined

  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : undefined
}

function resolveState(record: Record<string, unknown> | undefined): MessagePartInfo["state"] {
  const state = getRecordField(record, "state")
  if (!state) return undefined
  return {
    status: getStringField(state, "status"),
    input: getRecordField(state, "input"),
  }
}

function buildPartInfo(
  source: Record<string, unknown>,
  fallback: Record<string, unknown> | undefined,
): MessagePartInfo {
  return {
    id: getStringField(source, "id") ?? getStringField(source, "callID"),
    sessionID: getStringField(source, "sessionID") ?? getStringField(fallback, "sessionID"),
    type: getStringField(source, "type") ?? getStringField(fallback, "type"),
    tool: getStringField(source, "tool") ?? getStringField(fallback, "tool"),
    input: getRecordField(source, "input") ?? getRecordField(fallback, "input"),
    state: resolveState(source) ?? resolveState(fallback),
    field: getStringField(source, "field") ?? getStringField(fallback, "field"),
    activityTime: getDateField(source, "activityTime")
      ?? getDateField(source, "timestamp")
      ?? getDateField(fallback, "activityTime")
      ?? getDateField(fallback, "timestamp"),
  }
}

export function resolveMessagePartInfo(properties: unknown): MessagePartInfo | undefined {
  const props = isRecord(properties) ? properties : undefined
  if (!props) return undefined

  const nestedPart = getRecordField(props, "part")
  return nestedPart ? buildPartInfo(nestedPart, props) : buildPartInfo(props, undefined)
}

function sessionNextType(eventType: string): string {
  if (eventType.startsWith("session.next.reasoning.")) return "reasoning"
  if (eventType.startsWith("session.next.tool.") && eventType !== "session.next.tool.called") return "tool_result"
  return "text"
}

function isTrackedSessionNextActivityEvent(eventType: string): boolean {
  return eventType === "session.next.synthetic"
    || eventType === "session.next.retried"
    || eventType.startsWith("session.next.shell.")
    || eventType.startsWith("session.next.step.")
    || eventType.startsWith("session.next.text.")
    || eventType.startsWith("session.next.reasoning.")
    || eventType.startsWith("session.next.tool.")
    || eventType.startsWith("session.next.compaction.")
}

export function resolveSessionNextPartInfo(eventType: string, properties: unknown): MessagePartInfo | undefined {
  if (!eventType.startsWith(SESSION_NEXT_EVENT_PREFIX)) return undefined
  if (!isTrackedSessionNextActivityEvent(eventType)) return undefined

  const props = isRecord(properties) ? properties : undefined
  const sessionID = getStringField(props, "sessionID")
  if (!props || !sessionID) return undefined

  const input = getRecordField(props, "input")
  if (eventType === "session.next.tool.called") {
    return {
      id: getStringField(props, "callID"),
      sessionID,
      type: "tool",
      tool: getStringField(props, "tool"),
      input,
      state: {
        status: "running",
        input,
      },
      field: undefined,
      activityTime: getDateField(props, "timestamp"),
    }
  }

  return {
    id: getStringField(props, "callID"),
    sessionID,
    type: sessionNextType(eventType),
    tool: undefined,
    input: undefined,
    state: undefined,
    field: eventType.endsWith(".delta") ? sessionNextType(eventType) : undefined,
    activityTime: getDateField(props, "timestamp"),
  }
}

export function isMessagePartForSession(partInfo: MessagePartInfo | undefined, sessionID: string): boolean {
  return !partInfo?.sessionID || partInfo.sessionID === sessionID
}

export function hasOutputSignalFromPart(partInfo: MessagePartInfo | undefined, sessionID?: string): boolean {
  if (!partInfo) return false
  if (partInfo.sessionID && sessionID && partInfo.sessionID !== sessionID) return false
  if (!partInfo.sessionID && !sessionID) return false
  if (partInfo.tool) return true
  if (partInfo.type === "tool" || partInfo.type === "tool_result") return true
  if (partInfo.type === "text" || partInfo.type === "reasoning") return true

  return partInfo.field === "text" || partInfo.field === "reasoning"
}

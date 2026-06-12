import { isRecord } from "./record-type-guard"

function getStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function resolveSessionEventID(properties: unknown): string | undefined {
  const props = isRecord(properties) ? properties : undefined
  const info = isRecord(props?.info) ? props.info : undefined
  return getStringField(props, "sessionID")
    ?? getStringField(info, "sessionID")
    ?? getStringField(info, "id")
}

export function resolveMessageEventSessionID(properties: unknown): string | undefined {
  const props = isRecord(properties) ? properties : undefined
  const info = isRecord(props?.info) ? props.info : undefined
  const part = isRecord(props?.part) ? props.part : undefined
  return getStringField(props, "sessionID")
    ?? getStringField(info, "sessionID")
    ?? getStringField(part, "sessionID")
}

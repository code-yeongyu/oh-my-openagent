type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function getNestedRecord(value: unknown, key: string): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined
  const nested = value[key]
  return isRecord(nested) ? nested : undefined
}

function getNestedString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const nested = value[key]
  return typeof nested === "string" ? nested : undefined
}

export interface SessionCreatedEvent {
  type: string
  properties?: { info?: { id?: string; parentID?: string; title?: string } }
}

export function coerceSessionCreatedEvent(input: {
  type: string
  properties?: unknown
}): SessionCreatedEvent {
  const properties = isRecord(input.properties) ? input.properties : undefined
  const info = getNestedRecord(properties, "info")

  return {
    type: input.type,
    properties:
      info || properties
        ? {
            info: {
              id: getNestedString(info, "id"),
              parentID: getNestedString(info, "parentID"),
              title: getNestedString(info, "title"),
            },
          }
        : undefined,
  }
}

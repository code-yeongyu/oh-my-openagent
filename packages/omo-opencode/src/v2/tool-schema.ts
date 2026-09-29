import { toJSONSchema } from "zod"

const LOOSE_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isJsonSchema(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (value.type === "object" || Array.isArray(value.type) || value.properties !== undefined)
}

export function toolInputSchema(tool: { args?: unknown; parameters?: unknown; input?: unknown }): Record<string, unknown> {
  if (isJsonSchema(tool.input)) return tool.input
  if (isJsonSchema(tool.parameters)) return tool.parameters
  const args = tool.args
  if (!args) return { ...LOOSE_OBJECT_SCHEMA }
  try {
    const schema = toJSONSchema(args as never)
    if (isJsonSchema(schema)) return schema
  } catch {
    return { ...LOOSE_OBJECT_SCHEMA }
  }
  return { ...LOOSE_OBJECT_SCHEMA }
}

export function toolResult(result: unknown): { content: string; metadata?: Record<string, unknown> } {
  if (typeof result === "string") return { content: result }
  if (!isRecord(result)) return { content: result == null ? "" : String(result) }
  const metadata = isRecord(result.metadata) ? result.metadata : undefined
  if (typeof result.content === "string") return { content: result.content, ...(metadata ? { metadata } : {}) }
  if (typeof result.output === "string") return { content: result.output, ...(metadata ? { metadata } : {}) }
  return { content: JSON.stringify(result), ...(metadata ? { metadata } : {}) }
}

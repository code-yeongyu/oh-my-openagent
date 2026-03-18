import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"

type ToolArgSchema = ToolDefinition["args"][string]

type SchemaWithJsonSchemaOverride = ToolArgSchema & {
  _zod: ToolArgSchema["_zod"] & {
    toJSONSchema?: () => unknown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(["contentEncoding", "contentMediaType"])

function sanitizeJsonSchema(value: unknown, depth = 0, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchema(item, depth + 1, parentKey))
  }

  if (!isRecord(value)) {
    return value
  }

  const sanitized: Record<string, unknown> = {}
  const isInsideProperties = parentKey === "properties"

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isInsideProperties && UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      continue
    }

    if (depth === 0 && key === "$schema") {
      continue
    }

    sanitized[key] = sanitizeJsonSchema(nestedValue, depth + 1, key)
  }

  return sanitized
}

function attachJsonSchemaOverride(schema: SchemaWithJsonSchemaOverride): void {
  if (schema._zod.toJSONSchema) {
    return
  }

  schema._zod.toJSONSchema = (): Record<string, unknown> => {
    const originalOverride = schema._zod.toJSONSchema
    delete schema._zod.toJSONSchema

    try {
      const jsonSchema = tool.schema.toJSONSchema(schema)
      const sanitizedJsonSchema = sanitizeJsonSchema(jsonSchema)
      return isRecord(sanitizedJsonSchema) ? sanitizedJsonSchema : {}
    } finally {
      schema._zod.toJSONSchema = originalOverride
    }
  }
}

export function normalizeToolArgSchemas<TDefinition extends Pick<ToolDefinition, "args">>(
  toolDefinition: TDefinition,
): TDefinition {
  for (const schema of Object.values(toolDefinition.args)) {
    attachJsonSchemaOverride(schema)
  }

  return toolDefinition
}

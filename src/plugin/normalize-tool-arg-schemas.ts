import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"

type ToolArgSchema = ToolDefinition["args"][string]

type SchemaWithJsonSchemaOverride = ToolArgSchema & {
  _zod: ToolArgSchema["_zod"] & {
    toJSONSchema?: () => unknown
  }
}

function stripRootJsonSchemaFields(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = jsonSchema
  return rest
}

function attachJsonSchemaOverride(schema: SchemaWithJsonSchemaOverride): void {
  if (schema._zod.toJSONSchema) {
    return
  }

  schema._zod.toJSONSchema = (): Record<string, unknown> => {
    const originalOverride = schema._zod.toJSONSchema
    delete schema._zod.toJSONSchema

    try {
      return stripRootJsonSchemaFields(tool.schema.toJSONSchema(schema))
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

// Schema keywords unsupported by Gemini — strip them from MCP tool schemas
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(["contentEncoding", "contentMediaType"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function sanitizeJsonSchema(value: unknown, depth = 0, isPropertyName = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchema(item, depth + 1, false))
  }

  if (!isRecord(value)) {
    return value
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isPropertyName && UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      continue
    }

    if (depth === 0 && key === "$schema") {
      continue
    }

    const childIsPropertyName = key === "properties" && !isPropertyName
    sanitized[key] = sanitizeJsonSchema(nestedValue, depth + 1, childIsPropertyName)
  }

  return sanitized
}

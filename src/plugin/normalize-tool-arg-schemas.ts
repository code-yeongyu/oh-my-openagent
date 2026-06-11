import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { sanitizeJsonSchema, stripRootJsonSchemaFields } from "../host-tools"

type ToolArgSchema = ToolDefinition["args"][string]

type SchemaWithJsonSchemaOverride = ToolArgSchema & {
  _zod: ToolArgSchema["_zod"] & {
    toJSONSchema?: () => unknown
  }
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

export { sanitizeJsonSchema } from "../host-tools"

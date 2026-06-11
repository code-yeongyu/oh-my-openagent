import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"
import type { HostKind, JsonObject } from "../host-contract"

export type OpenCodeToolArgs = ToolDefinition["args"]

export type ToolParameterInput =
  | { kind: "opencode-args"; args: OpenCodeToolArgs }
  | { kind: "json-schema"; schema: JsonObject }
  | { kind: "native"; schema: unknown }

export type TargetToolParameters = {
  host: HostKind
  parameters: unknown
}

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(["contentEncoding", "contentMediaType"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asJsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) {
    throw new Error("Tool parameter schema must be a JSON object")
  }
  return value as JsonObject
}

export function stripRootJsonSchemaFields(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = jsonSchema
  return rest
}

function normalizeJsonSchemaRef(value: string): string {
  if (value.startsWith("#") || value.includes(":") || value.startsWith("/")) {
    return value
  }

  return `#/$defs/${value}`
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

    if (!isPropertyName && key === "$ref" && typeof nestedValue === "string") {
      sanitized[key] = normalizeJsonSchemaRef(nestedValue)
      continue
    }

    const childIsPropertyName = key === "properties" && !isPropertyName
    sanitized[key] = sanitizeJsonSchema(nestedValue, depth + 1, childIsPropertyName)
  }

  return sanitized
}

export function createOpenCodeToolParameterSchema(args: OpenCodeToolArgs): JsonObject {
  const rootSchema = tool.schema.toJSONSchema(tool.schema.object(args))
  return asJsonObject(sanitizeJsonSchema(rootSchema))
}

export function normalizeToolParameterInput(input: ToolParameterInput): unknown {
  switch (input.kind) {
    case "opencode-args":
      return createOpenCodeToolParameterSchema(input.args)
    case "json-schema":
      return asJsonObject(sanitizeJsonSchema(input.schema))
    case "native":
      return input.schema
  }
}

export function normalizeTargetToolParameters(host: HostKind, input: ToolParameterInput): TargetToolParameters {
  if (host === "opencode" && input.kind === "opencode-args") {
    return { host, parameters: input.args }
  }

  return {
    host,
    parameters: normalizeToolParameterInput(input),
  }
}

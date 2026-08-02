import { z } from "zod"
import { OmoConfigSchema } from "../packages/omo-config-core/src/schema"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

export const OMO_SCHEMA_ID =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const SCHEMA_MAP_KEYWORDS = [
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
] as const

const SCHEMA_VALUE_KEYWORDS = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Expected generated omo schema ${path} to be an object`)
  return value
}

function withoutSchemaIdentity(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== "$id" && key !== "$schema"),
  )
}

export function omitDefaultBackedRequiredProperties(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) omitDefaultBackedRequiredProperties(item)
    return
  }
  if (!isRecord(value)) return

  const properties = isRecord(value.properties) ? value.properties : undefined
  if (properties !== undefined && Array.isArray(value.required)) {
    const required = value.required.filter(
      (key): key is string =>
        typeof key === "string" &&
        (!isRecord(properties[key]) || !Object.hasOwn(properties[key], "default")),
    )
    if (required.length === 0) delete value.required
    else value.required = required
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const schemas = value[keyword]
    if (!isRecord(schemas)) continue
    for (const schema of Object.values(schemas)) omitDefaultBackedRequiredProperties(schema)
  }

  for (const keyword of SCHEMA_VALUE_KEYWORDS) {
    omitDefaultBackedRequiredProperties(value[keyword])
  }
}

export function createOmoJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(OmoConfigSchema, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>
  const properties = requiredRecord(jsonSchema.properties, "properties")
  const profiles = requiredRecord(properties.profiles, "properties.profiles")
  const profile = requiredRecord(profiles.additionalProperties, "properties.profiles.additionalProperties")
  const profileProperties = requiredRecord(profile.properties, "properties.profiles.additionalProperties.properties")
  const openCodeSchema = withoutSchemaIdentity(createOhMyOpenCodeJsonSchema())

  properties["[opencode]"] = { ...openCodeSchema }
  profileProperties["[opencode]"] = { ...openCodeSchema }
  omitDefaultBackedRequiredProperties(jsonSchema)

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: OMO_SCHEMA_ID,
    title: "Omo Configuration",
    description: "Configuration schema for the omo.json / omo.jsonc harness-neutral config surface",
    ...jsonSchema,
  }
}

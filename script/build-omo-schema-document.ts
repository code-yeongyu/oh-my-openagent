import { z } from "zod"
import { OmoConfigSchema } from "../packages/omo-config-core/src/schema"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

export const OMO_SCHEMA_ID =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Expected generated omo schema ${path} to be an object`)
  return value
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
  const openCodeSchema = createOhMyOpenCodeJsonSchema()

  // Strip $id from embedded schemas — they are inline copies, not standalone
  // entry points. A shared $id in two locations causes Ajv 2020 compilation
  // failure ("resolves to more than one schema") in both strict and
  // non-strict modes.
  const { $id: _unused, ...openCodeSchemaNoId } = openCodeSchema as { $id?: unknown; [key: string]: unknown }

  properties["[opencode]"] = openCodeSchemaNoId
  profileProperties["[opencode]"] = { ...openCodeSchemaNoId }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: OMO_SCHEMA_ID,
    title: "Omo Configuration",
    description: "Configuration schema for the omo.json / omo.jsonc harness-neutral config surface",
    ...jsonSchema,
  }
}

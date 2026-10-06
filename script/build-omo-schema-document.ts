import { z } from "zod"
import { OmoConfigSchema } from "../packages/omo-config-core/src/schema"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"
import { optionalizeDefaultedProperties } from "./json-schema-defaulted-optional"

export const OMO_SCHEMA_ID =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json"

const OPENCODE_DEFINITION = "opencode"
const OPENCODE_DEFINITION_REF = `#/definitions/${OPENCODE_DEFINITION}`

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
  optionalizeDefaultedProperties(jsonSchema)
  const properties = requiredRecord(jsonSchema.properties, "properties")
  const profiles = requiredRecord(properties.profiles, "properties.profiles")
  const profile = requiredRecord(profiles.additionalProperties, "properties.profiles.additionalProperties")
  const profileProperties = requiredRecord(profile.properties, "properties.profiles.additionalProperties.properties")
  const openCodeSchema = createOhMyOpenCodeJsonSchema()

  // Embed the [opencode] schema once, under definitions, and point both the top-level and the per-profile
  // block at it with a local reference. Two inline copies would carry the same $id, which validators
  // such as ajv refuse (#6444); an absolute $ref to that $id is not followed by tools that resolve only
  // local refs (z.fromJSONSchema). The embedded schema has no internal $refs, so it moves intact.
  const { $id: _openCodeId, $schema: _openCodeDialect, ...embeddedOpenCodeSchema } = openCodeSchema
  const definitions = isRecord(jsonSchema.definitions) ? jsonSchema.definitions : {}
  if (OPENCODE_DEFINITION in definitions) throw new Error(`Generated omo schema already defines ${OPENCODE_DEFINITION}`)
  jsonSchema.definitions = { ...definitions, [OPENCODE_DEFINITION]: embeddedOpenCodeSchema }
  properties["[opencode]"] = { $ref: OPENCODE_DEFINITION_REF }
  profileProperties["[opencode]"] = { $ref: OPENCODE_DEFINITION_REF }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: OMO_SCHEMA_ID,
    title: "OmO Configuration",
    description: "Configuration schema for the omo.json / omo.jsonc harness-neutral config surface",
    ...jsonSchema,
  }
}

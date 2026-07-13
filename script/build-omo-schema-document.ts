import { z } from "zod"
import { OmoConfigSchema } from "../packages/omo-config-core/src/schema"

export const OMO_SCHEMA_ID =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function addTeamLeadAgentRequirement(schema: Record<string, unknown>): void {
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  const teams = isRecord(properties?.teams) ? properties.teams : undefined
  const teamSpec = isRecord(teams?.additionalProperties) ? teams.additionalProperties : undefined
  if (teamSpec === undefined) {
    throw new Error("generated omo schema is missing the teams specification")
  }

  teamSpec.if = {
    properties: { members: { type: "array", minItems: 2 } },
    required: ["members"],
  }
  Reflect.set(teamSpec, "then", {
    properties: { leadAgentId: { type: "string" } },
    required: ["leadAgentId"],
  })
}

export function createOmoJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(OmoConfigSchema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>
  addTeamLeadAgentRequirement(jsonSchema)

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: OMO_SCHEMA_ID,
    title: "Omo Configuration",
    description: "Configuration schema for the omo.json / omo.jsonc harness-neutral config surface",
    ...jsonSchema,
  }
}

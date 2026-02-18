import { describe, expect, test } from "bun:test"
import { createOhMyOpenCodeJsonSchema } from "../../script/build-schema-document"

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

describe("schema document generation", () => {
  test("custom_agents schema allows arbitrary custom agent keys with override shape", () => {
    // given
    const schema = createOhMyOpenCodeJsonSchema()

    // when
    const rootProperties = asRecord(schema.properties)
    const agentsSchema = asRecord(rootProperties?.agents)
    const customAgentsSchema = asRecord(rootProperties?.custom_agents)
    const customPropertyNames = asRecord(customAgentsSchema?.propertyNames)
    const customAdditionalProperties = asRecord(customAgentsSchema?.additionalProperties)
    const customAgentProperties = asRecord(customAdditionalProperties?.properties)

    // then
    expect(agentsSchema).toBeDefined()
    expect(agentsSchema?.additionalProperties).toBeFalse()
    expect(customAgentsSchema).toBeDefined()
    expect(customPropertyNames?.pattern).toBeDefined()
    expect(customAdditionalProperties).toBeDefined()
    expect(customAgentProperties?.model).toEqual({ type: "string" })
    expect(customAgentProperties?.temperature).toEqual(
      expect.objectContaining({ type: "number" }),
    )
  })
})

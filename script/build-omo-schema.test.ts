import { describe, expect, test } from "bun:test"
import { createOmoJsonSchema, OMO_SCHEMA_ID } from "./build-omo-schema-document"

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

describe("build-omo-schema-document", () => {
  test("#given the omo config schema #when generated #then it is a draft-7 document with the config sections", () => {
    // given
    const expectedDraft = "http://json-schema.org/draft-07/schema#"

    // when
    const schema = createOmoJsonSchema()

    // then
    expect(schema.$schema).toBe(expectedDraft)
    expect(schema.$id).toBe(OMO_SCHEMA_ID)
    expect(schema.title).toBe("Omo Configuration")
    const properties = isRecord(schema.properties) ? schema.properties : {}
    expect(properties.categories).toBeDefined()
    expect(properties.agents).toBeDefined()
    expect(properties.task).toBeDefined()
    expect(properties.teams).toBeDefined()
  })

  test("#given the strict root object #when generated #then $schema is an allowed property and extras are rejected", () => {
    // given
    const schema = createOmoJsonSchema()

    // when
    const properties = isRecord(schema.properties) ? schema.properties : {}

    // then
    expect(properties.$schema).toBeDefined()
    expect(schema.additionalProperties).toBe(false)
  })
})

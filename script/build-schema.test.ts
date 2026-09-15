import { describe, expect, test } from "bun:test"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

describe("build-schema-document", () => {
  test("#given defaulted git_master #when generating the flat schema #then omission is allowed", () => {
    const schema = createOhMyOpenCodeJsonSchema()
    const properties = isRecord(schema.properties) ? schema.properties : {}

    expect(properties.git_master).toBeDefined()
    expect(schema.required ?? []).not.toContain("git_master")
  })

  test("generates schema with skills property", () => {
    // given
    const expectedDraft = "http://json-schema.org/draft-07/schema#"

    // when
    const schema = createOhMyOpenCodeJsonSchema()

    // then
    expect(schema.$schema).toBe(expectedDraft)
    expect(schema.title).toBe("Oh My OpenCode Configuration")
    expect(isRecord(schema.properties)).toBe(true)
    const properties = isRecord(schema.properties) ? schema.properties : {}
    expect(properties.skills).toBeDefined()
  })
})

import { describe, expect, test } from "bun:test"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

describe("build-schema-document", () => {
  test("generates schema with skills property", () => {
    // given
    const expectedDraft = "http://json-schema.org/draft-07/schema#"

    // when
    const schema = createOhMyOpenCodeJsonSchema()

    // then
    expect(schema.$schema).toBe(expectedDraft)
    expect(schema.title).toBe("Oh My OpenCode Configuration")
    expect(schema.properties).toBeDefined()
    expect(schema.properties.skills).toBeDefined()
  })
})

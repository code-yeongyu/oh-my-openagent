import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createEventState } from "./event-state"
import { loadOutputSchema, resolveTerminalStructuredOutput } from "./structured-output"

function writeSchema(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-output-schema-"))
  const path = join(directory, "result.schema.json")
  writeFileSync(path, contents)
  return path
}

describe("loadOutputSchema", () => {
  it("loads a JSON object schema", () => {
    // given
    const path = writeSchema('{"type":"object","required":["message"]}')

    // when
    const schema = loadOutputSchema(path)

    // then
    expect(schema).toEqual({ type: "object", required: ["message"] })
  })

  it("rejects malformed JSON", () => {
    // given
    const path = writeSchema('{"type":"object"')

    // when
    const load = () => loadOutputSchema(path)

    // then
    expect(load).toThrow("is not valid JSON")
  })

  it("rejects a non-object schema", () => {
    // given
    const path = writeSchema("[]")

    // when
    const load = () => loadOutputSchema(path)

    // then
    expect(load).toThrow("must be a JSON object")
  })
})

describe("resolveTerminalStructuredOutput", () => {
  it("returns structured output captured for the terminal root assistant message", () => {
    // given
    const state = createEventState()
    state.hasStructuredOutput = true
    state.structuredOutput = { status: "completed" }

    // when
    const output = resolveTerminalStructuredOutput(state, "ses_root")

    // then
    expect(output).toEqual({ status: "completed" })
  })

  it("fails when the terminal root assistant message has no structured value", () => {
    // given
    const state = createEventState()
    state.structuredOutput = { status: "stale" }

    // when
    const output = () => resolveTerminalStructuredOutput(state, "ses_root")

    // then
    expect(output).toThrow("terminal assistant response")
  })
})

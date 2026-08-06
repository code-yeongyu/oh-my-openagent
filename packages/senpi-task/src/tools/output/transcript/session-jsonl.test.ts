import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { parseSessionTranscript } from "./session-jsonl"

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "..", "..", "test-support", "session-jsonl")

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8")
}

function assistantTexts(text: string): readonly string[] {
  return parseSessionTranscript(text)
    .filter((entry) => entry.kind === "assistant")
    .map((entry) => (entry.kind === "assistant" ? entry.text : ""))
}

describe("parseSessionTranscript", () => {
  test("#given a v1 linear session #when parsed #then only assistant text entries are extracted in order", () => {
    // given
    const text = fixture("v1.jsonl")

    // when
    const texts = assistantTexts(text)

    // then
    expect(texts).toEqual([
      "The build fails because of a missing import.",
      "Fixed it. The import path was wrong.",
    ])
  })

  test("#given a v2 tree session with a model_change and toolResult #when parsed #then user/tool/non-message entries are skipped", () => {
    // given
    const text = fixture("v2.jsonl")

    // when
    const texts = assistantTexts(text)

    // then
    expect(texts).toEqual(["The module exposes a task manager.", "It also owns the record store."])
  })

  test("#given a v3 session with custom, custom_message, and an unknown future entry #when parsed #then unknown types are tolerated and only assistant text survives", () => {
    // given
    const text = fixture("v3.jsonl")

    // when
    const texts = assistantTexts(text)

    // then
    expect(texts).toEqual(["Cutting the release now.", "Release v9 is live."])
  })

  test("#given malformed lines mixed with valid ones #when parsed #then broken lines are skipped without throwing", () => {
    // given
    const text = [
      `{"type":"session","version":3,"id":"x"}`,
      "not-json-at-all",
      `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"survived"}]}}`,
      "",
    ].join("\n")

    // when
    const texts = assistantTexts(text)

    // then
    expect(texts).toEqual(["survived"])
  })

  test("#given an assistant message with multiple text blocks #when parsed #then the blocks are concatenated", () => {
    // given
    const text = `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"part one "},{"type":"thinking","thinking":"hmm"},{"type":"text","text":"part two"}]}}`

    // when
    const texts = assistantTexts(text)

    // then
    expect(texts).toEqual(["part one part two"])
  })
})

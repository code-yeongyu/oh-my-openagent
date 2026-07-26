import { describe, expect, test } from "bun:test"

import { TRANSCRIPT_MAX_CHARS, renderTranscript } from "./render"
import type { TranscriptEntry } from "./types"

const assistant = (text: string): TranscriptEntry => ({ kind: "assistant", text })
const tool = (name: string, isError = false): TranscriptEntry => ({ kind: "tool", tool: name, is_error: isError })

describe("renderTranscript", () => {
  test("#given entries #when full mode #then every entry is rendered and not truncated", () => {
    // given
    const entries = [assistant("first answer"), tool("bash"), assistant("second answer")]

    // when
    const rendered = renderTranscript(entries, { mode: "full", tailLines: 60 })

    // then
    expect(rendered.text).toContain("first answer")
    expect(rendered.text).toContain("bash")
    expect(rendered.text).toContain("second answer")
    expect(rendered.truncated).toBe(false)
  })

  test("#given a transcript with more lines than tailLines #when tail mode #then only the last tailLines lines remain", () => {
    // given
    const entries = Array.from({ length: 10 }, (_v, index) => assistant(`line ${index}`))

    // when
    const rendered = renderTranscript(entries, { mode: "tail", tailLines: 3 })

    // then
    const lines = rendered.text.trim().split("\n")
    expect(lines.length).toBe(3)
    expect(rendered.text).toContain("line 9")
    expect(rendered.text).not.toContain("line 0")
  })

  test("#given a transcript longer than the cap #when rendered #then it is elided with a head/tail marker under the cap", () => {
    // given
    const big = "x".repeat(TRANSCRIPT_MAX_CHARS * 2)
    const entries = [assistant(big)]

    // when
    const rendered = renderTranscript(entries, { mode: "full", tailLines: 60 })

    // then
    expect(rendered.text.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS)
    expect(rendered.text).toContain("elided")
    expect(rendered.truncated).toBe(true)
  })

  test("#given no entries #when rendered #then an empty-transcript notice is returned and not truncated", () => {
    // given / when
    const rendered = renderTranscript([], { mode: "full", tailLines: 60 })

    // then
    expect(rendered.truncated).toBe(false)
    expect(rendered.text.length).toBeGreaterThan(0)
  })
})

describe("renderTranscript error entries", () => {
  test("#given an error transcript entry #when rendered #then it is shown as an error line", () => {
    // given
    const entries = [{ kind: "error", message: "upstream gateway timeout" }] as unknown as Parameters<typeof renderTranscript>[0]

    // when
    const rendered = renderTranscript(entries, { mode: "full", tailLines: 0 })

    // then
    expect(rendered.text).toBe("error: upstream gateway timeout")
  })
})

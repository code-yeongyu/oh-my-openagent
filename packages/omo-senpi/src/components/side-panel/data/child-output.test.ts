import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultTranscriptReader, renderTranscript } from "@oh-my-opencode/senpi-task"

import { childOutputRows, NO_OUTPUT_NOTICE } from "./child-output"

describe("childOutputRows", () => {
  test("#given a rendered transcript #when laid out #then each line is a row coloured by its prefix", () => {
    // given the shape the task engine renders
    const text = ["assistant: on it", "tool: read", "tool[error]: bash", "error: child exited 1"].join("\n")

    // when
    const rows = childOutputRows(text, false)

    // then
    expect(rows.map((row) => [row.text, row.color])).toEqual([
      ["assistant: on it", "text"],
      ["tool: read", "muted"],
      ["tool[error]: bash", "error"],
      ["error: child exited 1", "error"],
    ])
  })

  test("#given a wrapped assistant paragraph #when laid out #then continuation lines keep reading as prose", () => {
    // given only the first line carries the prefix
    const rows = childOutputRows("assistant: first\nsecond line\nthird line", false)

    // then
    expect(rows.map((row) => row.color)).toEqual(["text", "text", "text"])
  })

  test("#given a child that recorded nothing #when laid out #then the viewer says so once", () => {
    // given / when
    const rows = childOutputRows("", false)

    // then
    expect(rows).toEqual([{ text: NO_OUTPUT_NOTICE, color: "dim" }])
  })

  test("#given the engine elided earlier output #when laid out #then the tail is not passed off as the end", () => {
    // given
    const rows = childOutputRows("assistant: tail", true)

    // then
    expect(rows.at(-1)).toEqual({
      text: "(earlier output elided by the task engine's transcript cap)",
      color: "dim",
    })
  })
})

// Not a mock: this drives the task engine's own reader and renderer over a real state dir, because
// the format of that text is a contract the panel depends on and cannot see from the inside.
describe("childOutputRows over the engine's real transcript", () => {
  test("#given a child's event log on disk #when read through the engine #then the rows are what a click shows", () => {
    // given
    const stateDir = mkdtempSync(join(tmpdir(), "omo-child-output-"))
    mkdirSync(join(stateDir, "logs"), { recursive: true })
    writeFileSync(
      join(stateDir, "logs", "st_1.jsonl"),
      [
        JSON.stringify({ type: "assistant_message", payload: { text: "read the file, nothing to change" } }),
        JSON.stringify({ type: "tool_execution", payload: { tool: "read" } }),
      ].join("\n"),
    )

    // when
    const result = defaultTranscriptReader({ taskId: "st_1", stateDir })
    const rendered = renderTranscript(result.entries, { mode: "full", tailLines: 0 })
    const rows = childOutputRows(rendered.text, rendered.truncated)

    // then
    expect(result.source).toBe("event-log")
    expect(rows.map((row) => row.text)).toEqual([
      "assistant: read the file, nothing to change",
      "tool: read",
    ])
    expect(rows.map((row) => row.color)).toEqual(["text", "muted"])
  })

  test("#given no log at all #when read through the engine #then the viewer says nothing was recorded", () => {
    // given
    const stateDir = mkdtempSync(join(tmpdir(), "omo-child-output-empty-"))

    // when
    const result = defaultTranscriptReader({ taskId: "st_missing", stateDir })
    const rendered = renderTranscript(result.entries, { mode: "full", tailLines: 0 })

    // then
    expect(result.source).toBe("none")
    expect(childOutputRows(rendered.text, rendered.truncated).map((row) => row.text)).toEqual([
      NO_OUTPUT_NOTICE,
    ])
  })
})

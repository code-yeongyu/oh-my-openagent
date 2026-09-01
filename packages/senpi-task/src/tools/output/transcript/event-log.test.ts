import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { readEventLogTranscript, readEventLogTranscriptResult } from "./event-log"
import { MAX_TRANSCRIPT_SOURCE_BYTES } from "./read-bounded"

function writeLog(lines: readonly string[]): string {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-event-log-"))
  mkdirSync(join(stateDir, "logs"), { recursive: true })
  writeFileSync(join(stateDir, "logs", "st_1.jsonl"), lines.join("\n") + "\n")
  return stateDir
}

describe("readEventLogTranscript", () => {
  test("#given a log with assistant, tool, and child_error events #when read #then all three are lifted in order", () => {
    // given
    const stateDir = writeLog([
      JSON.stringify({ type: "assistant_message", payload: { text: "working on it" } }),
      JSON.stringify({ type: "tool_execution", payload: { tool: "bash", is_error: false } }),
      JSON.stringify({ type: "child_error", payload: { message: "upstream gateway timeout", stop_reason: "error" } }),
    ])

    // when
    const entries = readEventLogTranscript(stateDir, "st_1")

    // then the error breadcrumb is part of the transcript
    expect(entries).toEqual([
      { kind: "assistant", text: "working on it" },
      { kind: "tool", tool: "bash", is_error: false },
      { kind: "error", message: "upstream gateway timeout" },
    ])
  })

  test("#given a large event log #when read #then head and tail events survive with source truncation", () => {
    const stateDir = writeLog([
      JSON.stringify({ type: "assistant_message", payload: { text: "first" } }),
      JSON.stringify({ type: "ignored", payload: { text: "x".repeat(MAX_TRANSCRIPT_SOURCE_BYTES) } }),
      JSON.stringify({ type: "assistant_message", payload: { text: "last" } }),
    ])

    const result = readEventLogTranscriptResult(stateDir, "st_1")

    expect(result.truncated).toBe(true)
    expect(result.entries).toEqual([
      { kind: "assistant", text: "first" },
      { kind: "assistant", text: "last" },
    ])
  })
})

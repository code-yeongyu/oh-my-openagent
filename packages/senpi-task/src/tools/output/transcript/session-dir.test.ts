import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { childSessionDir, readSessionDirTranscriptResult } from "./session-dir"

describe("readSessionDirTranscriptResult", () => {
  test("#given more than two child session files #when read #then only bounded edge files are parsed", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-session-dir-"))
    const sessionDir = childSessionDir(stateDir, "st_1")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "001.jsonl"), message("first"))
    writeFileSync(join(sessionDir, "002.jsonl"), message("middle"))
    writeFileSync(join(sessionDir, "003.jsonl"), message("last"))

    const result = readSessionDirTranscriptResult(stateDir, "st_1")

    expect(result.truncated).toBe(true)
    expect(result.entries).toEqual([
      { kind: "assistant", text: "first" },
      { kind: "assistant", text: "last" },
    ])
  })
})

function message(text: string): string {
  return `${JSON.stringify({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }] },
  })}\n`
}

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, mock } from "bun:test"

const TEST_STORAGE_ROOT = join(tmpdir(), `session-recovery-thinking-strip-${randomUUID()}`)
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")

mock.module("../../../shared", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: join(TEST_STORAGE_ROOT, "message"),
  PART_STORAGE: TEST_PART_STORAGE,
  log: () => {},
  isSqliteBackend: () => false,
  deletePart: async () => true,
  normalizeSDKResponse: (_response: unknown, fallback: unknown) => fallback,
}))

const { stripThinkingParts } = await import("./thinking-strip")

describe("stripThinkingParts", () => {
  it("#given a malformed part file #when stripping thinking #then skips the bad file and removes valid thinking", () => {
    // given
    const messageID = "msg_thinking_strip_malformed"
    const partDir = join(TEST_PART_STORAGE, messageID)
    const malformedPath = join(partDir, "bad.json")
    const thinkingPath = join(partDir, "thinking.json")
    const textPath = join(partDir, "text.json")

    mkdirSync(partDir, { recursive: true })
    writeFileSync(malformedPath, "{")
    writeFileSync(
      thinkingPath,
      JSON.stringify({
        id: "prt_thinking",
        sessionID: "ses_thinking_strip",
        messageID,
        type: "thinking",
        thinking: "signed reasoning",
      })
    )
    writeFileSync(
      textPath,
      JSON.stringify({
        id: "prt_text",
        sessionID: "ses_thinking_strip",
        messageID,
        type: "text",
        text: "visible answer",
      })
    )

    // when
    const result = stripThinkingParts(messageID)

    // then
    expect(result).toBe(true)
    expect(existsSync(malformedPath)).toBe(true)
    expect(existsSync(thinkingPath)).toBe(false)
    expect(existsSync(textPath)).toBe(true)

    rmSync(join(TEST_PART_STORAGE, messageID), { recursive: true, force: true })
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sessionJsonlContainsMessage } from "./session-scan"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("sessionJsonlContainsMessage", () => {
  test("#given a hidden custom message with a peer envelope #when scanned #then it finds the messageId", async () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-member-session-scan-"))
    roots.push(root)
    const messageId = "message-hidden-1"
    const content = `<peer_message from="lead" to="worker" messageId="${messageId}">hello</peer_message>`
    writeFileSync(
      join(root, "session.jsonl"),
      `${JSON.stringify({
        type: "custom_message",
        customType: "senpi-task:team-message",
        display: false,
        content,
      })}\n`,
      "utf8",
    )

    expect(await sessionJsonlContainsMessage(root, messageId)).toBe(true)
  })
})

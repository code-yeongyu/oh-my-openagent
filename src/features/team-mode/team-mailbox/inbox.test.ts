/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

const logCalls: Array<[string, unknown?]> = []

mock.module("../../../shared/logger", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push([message, data])
  },
}))

const { listUnreadMessages } = await import("./inbox")
const { TeamModeConfigSchema } = await import("../../../config/schema/team-mode")
const { getInboxDir, resolveBaseDir } = await import("../team-registry/paths")

async function createBaseDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-inbox-"))
}

describe("listUnreadMessages", () => {
  test("returns FIFO messages while skipping malformed, processed, and dot files", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    await mkdir(path.join(inboxDir, "processed"), { recursive: true })

    await writeFile(path.join(inboxDir, "later.json"), JSON.stringify({
      version: 1,
      messageId: randomUUID(),
      from: "m2",
      to: "m1",
      kind: "message",
      body: "later",
      timestamp: 200,
    }))
    await writeFile(path.join(inboxDir, "earlier.json"), JSON.stringify({
      version: 1,
      messageId: randomUUID(),
      from: "m3",
      to: "m1",
      kind: "message",
      body: "earlier",
      timestamp: 100,
    }))
    await writeFile(path.join(inboxDir, "bad.json"), "{not-json")
    await writeFile(path.join(inboxDir, ".hidden.json"), "{}")
    await writeFile(path.join(inboxDir, "processed", "done.json"), "{}")
    logCalls.splice(0)

    // when
    const unreadMessages = await listUnreadMessages(teamRunId, "m1", config)

    // then
    expect(unreadMessages.map((message) => message.body)).toEqual(["earlier", "later"])
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.[0]).toContain("skipped unreadable message")
  })
})

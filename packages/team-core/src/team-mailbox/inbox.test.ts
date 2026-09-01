/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

const { TeamModeConfigSchema } = await import("../config")
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
    const { listUnreadMessages } = await import("./inbox")

    // when
    const unreadMessages = await listUnreadMessages(teamRunId, "m1", config)

    // then
    expect(unreadMessages.map((message) => message.body)).toEqual(["earlier", "later"])
  })
})

describe("readUnreadMessageById", () => {
  test("#given an unread message is reserved for delivery #when it is inspected #then the reserved message remains visible", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    const message = {
      version: 1,
      messageId,
      from: "m2",
      to: "m1",
      kind: "message",
      body: "reserved but unread",
      timestamp: 100,
    }
    await mkdir(inboxDir, { recursive: true })
    await writeFile(path.join(inboxDir, `${messageId}.json`), JSON.stringify(message))
    const { reserveMessageForDelivery } = await import("./reservation")
    const reservation = await reserveMessageForDelivery(teamRunId, "m1", messageId, config)
    const { readUnreadMessageById } = await import("./inbox")

    // when
    const unreadMessage = await readUnreadMessageById(teamRunId, "m1", messageId, config)

    // then
    expect(reservation).not.toBeNull()
    expect(unreadMessage).toEqual(message)
  })

  test("#given the exact unread path cannot be read #when it is inspected #then the read error is preserved for retry", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    await mkdir(path.join(inboxDir, `${messageId}.json`), { recursive: true })
    const { readUnreadMessageById } = await import("./inbox")

    // when
    const result = Promise.resolve().then(
      () => readUnreadMessageById(teamRunId, "m1", messageId, config),
    )

    // then
    await expect(result).rejects.toHaveProperty("code")
  })
})

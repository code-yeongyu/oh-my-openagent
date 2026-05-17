/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { MessageSchema } from "../types"
import {
  BroadcastNotPermittedError,
  DuplicateMessageIdError,
  PayloadTooLargeError,
  RecipientBackpressureError,
  sendMessage,
} from "./send"

async function createBaseDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-send-"))
}

function createConfig(baseDir: string) {
  return TeamModeConfigSchema.parse({ base_dir: baseDir })
}

function createMessage(overrides?: Partial<Parameters<typeof sendMessage>[0]>) {
  return MessageSchema.parse({
    version: 1,
    messageId: randomUUID(),
    from: "lead",
    to: "m1",
    kind: "message",
    body: "hello",
    timestamp: Date.now(),
    ...overrides,
  })
}

describe("sendMessage", () => {
  test("writes distinct files for concurrent writers targeting the same recipient", async () => {
    // given
    const baseDir = await createBaseDirectory()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const messages = Array.from({ length: 4 }, (_, index) => createMessage({
      from: `m${index + 1}`,
      body: `message-${index + 1}`,
      timestamp: 100 + index,
    }))

    // when
    await Promise.all(messages.map(async (message) => {
      await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["m1"] })
    }))

    // then
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    const fileNames = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    expect(fileNames).toHaveLength(4)

    const parsedMessages = await Promise.all(fileNames.map(async (fileName) => {
      const fileContent = await readFile(path.join(inboxDir, fileName), "utf8")
      return MessageSchema.parse(JSON.parse(fileContent))
    }))
    expect(new Set(parsedMessages.map((message) => message.messageId)).size).toBe(4)
  })

  test("rejects payloads larger than 32 KB", async () => {
    // given
    const config = createConfig(await createBaseDirectory())
    const message = createMessage({ body: "가".repeat(20_000) })

    // when
    const result = sendMessage(message, randomUUID(), config, { isLead: false, activeMembers: ["m1"] })

    // then
    try {
      await result
      throw new Error("expected sendMessage to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadTooLargeError)
    }
  })

  test("rejects sends when recipient unread bytes exceed the backpressure limit", async () => {
    // given
    const baseDir = await createBaseDirectory()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    await mkdir(inboxDir, { recursive: true })
    await writeFile(path.join(inboxDir, "full.json"), "x".repeat(config.recipient_unread_max_bytes + 1), { flag: "w" })

    // when
    const result = sendMessage(createMessage(), teamRunId, config, { isLead: false, activeMembers: ["m1"] })

    // then
    try {
      await result
      throw new Error("expected sendMessage to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(RecipientBackpressureError)
    }
  })

  test("counts in-flight .delivering-* reservations toward recipient backpressure", async () => {
    // given
    const baseDir = await createBaseDirectory()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    await mkdir(inboxDir, { recursive: true })
    const pendingMessageId = randomUUID()
    await writeFile(
      path.join(inboxDir, `.delivering-${pendingMessageId}.json`),
      "x".repeat(config.recipient_unread_max_bytes + 1),
      { flag: "w" },
    )

    // when
    const result = sendMessage(createMessage(), teamRunId, config, { isLead: false, activeMembers: ["m1"] })

    // then
    try {
      await result
      throw new Error("expected sendMessage to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(RecipientBackpressureError)
    }
  })

  test("rejects duplicate message ids for the same recipient", async () => {
    // given
    const baseDir = await createBaseDirectory()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const message = createMessage()
    await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["m1"] })

    // when
    const result = sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["m1"] })

    // then
    try {
      await result
      throw new Error("expected sendMessage to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateMessageIdError)
    }
  })

  test("gates broadcasts to leads and fans out to each active member", async () => {
    // given
    const baseDir = await createBaseDirectory()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const broadcastMessage = createMessage({ to: "*" })

    // when
    const rejectedSend = sendMessage(broadcastMessage, teamRunId, config, {
      isLead: false,
      activeMembers: ["m1", "m2"],
    })
    const deliveredSend = sendMessage(broadcastMessage, teamRunId, config, {
      isLead: true,
      activeMembers: ["m1", "m2"],
    })

    // then
    try {
      await rejectedSend
      throw new Error("expected sendMessage to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(BroadcastNotPermittedError)
    }

    expect(await deliveredSend).toEqual({
      messageId: broadcastMessage.messageId,
      deliveredTo: ["m1", "m2"],
    })

    const memberOneFiles = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "m1"))
    const memberTwoFiles = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "m2"))
    expect(memberOneFiles.filter((entry) => entry.endsWith(".json"))).toHaveLength(1)
    expect(memberTwoFiles.filter((entry) => entry.endsWith(".json"))).toHaveLength(1)
  })
})

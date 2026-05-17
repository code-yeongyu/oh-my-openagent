/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { ackMessages } from "./ack"
import { sendMessage } from "./send"

async function createBaseDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-ack-"))
}

describe("ackMessages", () => {
  test("moves inbox files into processed and stays idempotent", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await sendMessage({
      version: 1,
      messageId,
      from: "lead",
      to: "m1",
      kind: "message",
      body: "hello",
      timestamp: 100,
    }, teamRunId, config, { isLead: true, activeMembers: ["m1"] })

    // when
    await ackMessages(teamRunId, "m1", [messageId], config)
    await ackMessages(teamRunId, "m1", [messageId], config)

    // then
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    const inboxEntries = await readdir(inboxDir)
    const processedEntries = await readdir(path.join(inboxDir, "processed"))
    expect(inboxEntries).not.toContain(`${messageId}.json`)
    expect(processedEntries).toContain(`${messageId}.json`)
  })
})

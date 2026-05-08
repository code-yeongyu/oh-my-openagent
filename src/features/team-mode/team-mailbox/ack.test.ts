/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { saveRuntimeState } from "../team-state-store/store"
import { ackMessages } from "./ack"
import { sendMessage } from "./send"

async function createBaseDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-ack-"))
}

async function seedRuntime(baseDir: string, teamRunId: string): Promise<void> {
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
  await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
  await saveRuntimeState({
    version: 1,
    teamRunId,
    teamName: "team-mailbox-ack",
    specSource: "project",
    createdAt: Date.now(),
    status: "active",
    leadSessionId: "lead-session",
    members: [
      {
        name: "m1",
        agentType: "general-purpose",
        sessionId: "m1-session",
        status: "running",
        turnsUsed: 0,
        pendingInjectedMessageIds: [],
      },
    ],
    shutdownRequests: [],
    messageCount: 0,
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: config.max_messages_per_run,
      maxWallClockMinutes: config.max_wall_clock_minutes,
      maxMemberTurns: config.max_member_turns,
    },
  }, config)
}

describe("ackMessages", () => {
  test("moves inbox files into processed and stays idempotent", async () => {
    // given
    const baseDir = await createBaseDirectory()
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await seedRuntime(baseDir, teamRunId)
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

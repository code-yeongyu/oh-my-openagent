/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { listUnreadMessages } from "../../features/team-mode/team-mailbox/inbox"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import { clearTeamSessionRegistry } from "../../features/team-mode/team-session-registry"
import { getInboxDir, resolveBaseDir } from "../../features/team-mode/team-registry/paths"
import { loadRuntimeState, saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import type { RuntimeState } from "../../features/team-mode/types"
import { createTeamIdleWakeHint } from "./team-idle-wake-hint"

const temporaryDirectories: string[] = []

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function createRuntimeState(teamRunId: string, pendingInjectedMessageIds: string[]): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [
      {
        name: "worker",
        sessionId: "member-session",
        agentType: "general-purpose",
        status: "idle",
        pendingInjectedMessageIds,
      },
    ],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
}

async function seedReservedPendingMessage(config: TeamModeConfig, messageId: string): Promise<string> {
  const teamRunId = randomUUID()
  await mkdir(path.join(config.base_dir ?? "", "runtime", teamRunId), { recursive: true })
  await saveRuntimeState(createRuntimeState(teamRunId, [messageId]), config)
  await sendMessage({
    version: 1,
    messageId,
    from: "lead",
    to: "worker",
    kind: "message",
    body: "in-flight live delivery",
    timestamp: 100,
  }, teamRunId, config, {
    isLead: true,
    activeMembers: ["worker"],
    reservedRecipients: new Set(["worker"]),
  })
  return teamRunId
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function driveIdle(config: TeamModeConfig, withMessagesApi: boolean): Promise<void> {
  const session: Record<string, unknown> = {}
  if (withMessagesApi) {
    session.messages = async () => ({ data: [] })
  }
  const handler = createTeamIdleWakeHint({
    directory: "/tmp/project",
    client: { session },
  } as never, config)
  await handler({
    event: {
      type: "session.idle",
      properties: { sessionID: "member-session" },
    },
  })
}

afterEach(async () => {
  clearTeamSessionRegistry()
  await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
    await rm(directoryPath, { recursive: true, force: true })
  }))
})

describe("issue #5101 - pending live delivery must not be silently lost on idle-ack", () => {
  test("#given a reserved (.delivering-) message pending injection that never reached the recipient #when the recipient idles #then the message stays recoverable by poll-injection", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "wake-hint-delivering-loss-"))
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const messageId = randomUUID()
    const teamRunId = await seedReservedPendingMessage(config, messageId)

    // when
    await driveIdle(config, true)

    // then
    const unreadMessages = await listUnreadMessages(teamRunId, "worker", config)
    expect(unreadMessages.map((message) => message.messageId)).toContain(messageId)
    const processedPath = path.join(getInboxDir(resolveBaseDir(config), teamRunId, "worker"), "processed", `${messageId}.json`)
    expect(await fileExists(processedPath)).toBe(false)
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.pendingInjectedMessageIds).toEqual([])
  })

  test("#given the client cannot read session history #when the recipient idles #then the prior ack-all behavior is preserved (loss-safe fallback unavailable)", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "wake-hint-delivering-ackall-"))
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const messageId = randomUUID()
    const teamRunId = await seedReservedPendingMessage(config, messageId)

    // when
    await driveIdle(config, false)

    // then
    const processedPath = path.join(getInboxDir(resolveBaseDir(config), teamRunId, "worker"), "processed", `${messageId}.json`)
    expect(await fileExists(processedPath)).toBe(true)
    expect(await listUnreadMessages(teamRunId, "worker", config)).toEqual([])
  })
})

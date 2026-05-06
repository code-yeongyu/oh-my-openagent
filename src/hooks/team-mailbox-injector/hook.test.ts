import { afterEach, describe, expect, it } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import type { RuntimeState } from "../../features/team-mode/types"
import { saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import { createTeamMailboxInjector } from "./hook"

function createRuntimeState(sessionID: string, teamRunId = randomUUID()): RuntimeState {
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
        name: "member-a",
        sessionId: sessionID,
        agentType: "general-purpose",
        status: "running",
        lastInjectedTurnMarker: undefined,
        pendingInjectedMessageIds: [],
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

async function createTemporaryBaseDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-injector-"))
}

async function seedRuntimeState(baseDir: string, runtimeState: RuntimeState): Promise<void> {
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
  await mkdir(path.join(baseDir, "runtime", runtimeState.teamRunId), { recursive: true })
  await saveRuntimeState(runtimeState, config)
}

function createHook(baseDir: string) {
  return createTeamMailboxInjector(
    {},
    TeamModeConfigSchema.parse({ enabled: true, base_dir: baseDir }),
  )
}

function createOutput(sessionID: string): {
  messages: Array<{
    info: { role: string; sessionID: string }
    parts: Array<{ type: string; text?: string; synthetic?: boolean }>
  }>
} {
  return {
    messages: [
      {
        info: {
          role: "user",
          sessionID,
        },
        parts: [{ type: "text", text: "original message" }],
      },
    ],
  }
}

describe("createTeamMailboxInjector", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    clearTeamSessionRegistry()
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => rm(directoryPath, { recursive: true, force: true })))
  })

  it("returns the input unchanged for a non-member session", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const hook = createHook(baseDir)
    const output = createOutput("session-non-member")
    const originalMessages = structuredClone(output.messages)

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-non-member" },
      output,
    )

    // then
    expect(output.messages).toEqual(originalMessages)
  })

  it("prepends an envelope as a user-role message for a member session", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const hook = createHook(baseDir)
    const runtimeState = createRuntimeState("session-member")
    await seedRuntimeState(baseDir, runtimeState)
    await sendMessage({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "member-a",
      kind: "message",
      body: "hello",
      timestamp: 1,
    }, runtimeState.teamRunId, TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true }), { isLead: true, activeMembers: ["lead", "member-a"] })
    const output = createOutput("session-member")

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-member" },
      output,
    )

    // then
    expect(output.messages).toHaveLength(2)
    expect(output.messages[0]).toEqual({
      info: {
        role: "user",
        sessionID: "session-member",
      },
      parts: [
        {
          type: "text",
          text: expect.stringContaining('<peer_message from="lead"'),
          synthetic: true,
        },
      ],
    })
  })

  it("does not inject twice for the same turn marker", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const hook = createHook(baseDir)
    const runtimeState = createRuntimeState("session-member")
    await seedRuntimeState(baseDir, runtimeState)
    await sendMessage({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "member-a",
      kind: "message",
      body: "hello",
      timestamp: 1,
    }, runtimeState.teamRunId, TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true }), { isLead: true, activeMembers: ["lead", "member-a"] })
    const firstOutput = createOutput("session-member")
    const secondOutput = createOutput("session-member")
    const originalSecondMessages = structuredClone(secondOutput.messages)

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-member" },
      firstOutput,
    )
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-member" },
      secondOutput,
    )

    // then
    expect(firstOutput.messages).toHaveLength(2)
    expect(secondOutput.messages).toEqual(originalSecondMessages)
  })

  it("injects mailbox messages during the spawn race when the registry has the fresh member session but disk state is stale", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const hook = createHook(baseDir)
    const teamRunId = randomUUID()
    const staleRuntimeState: RuntimeState = {
      ...createRuntimeState("stale-session", teamRunId),
      members: [
        {
          name: "member-a",
          agentType: "general-purpose",
          status: "running",
          lastInjectedTurnMarker: undefined,
          pendingInjectedMessageIds: [],
        },
      ],
    }
    await seedRuntimeState(baseDir, staleRuntimeState)
    await sendMessage({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "member-a",
      kind: "message",
      body: "fresh registry hello",
      timestamp: 1,
    }, teamRunId, TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true }), { isLead: true, activeMembers: ["lead", "member-a"] })
    registerTeamSession("session-member", {
      teamRunId,
      memberName: "member-a",
      role: "member",
    })
    const output = createOutput("session-member")

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-member" },
      output,
    )

    // then
    expect(output.messages).toHaveLength(2)
    expect(output.messages[0]?.parts[0]?.text).toContain("fresh registry hello")
  })

  it("falls back to disk lookup when the registry points the session at the wrong teamRunId", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const hook = createHook(baseDir)
    const correctTeamRunId = randomUUID()
    const wrongTeamRunId = randomUUID()
    await seedRuntimeState(baseDir, createRuntimeState("session-member", correctTeamRunId))
    await seedRuntimeState(baseDir, createRuntimeState("other-session", wrongTeamRunId))
    await sendMessage({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "member-a",
      kind: "message",
      body: "message for the correct team",
      timestamp: 1,
    }, correctTeamRunId, TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true }), { isLead: true, activeMembers: ["lead", "member-a"] })
    await sendMessage({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "member-a",
      kind: "message",
      body: "message for the wrong team",
      timestamp: 2,
    }, wrongTeamRunId, TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true }), { isLead: true, activeMembers: ["lead", "member-a"] })
    registerTeamSession("session-member", {
      teamRunId: wrongTeamRunId,
      memberName: "member-a",
      role: "member",
    })
    const output = createOutput("session-member")

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-member" },
      output,
    )

    // then
    expect(output.messages).toHaveLength(2)
    const injectedText = output.messages[0]?.parts[0]?.text ?? ""
    expect(injectedText).toContain("message for the correct team")
    expect(injectedText).not.toContain("message for the wrong team")
  })
})

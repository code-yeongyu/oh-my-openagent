/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import type { RuntimeState } from "../../features/team-mode/types"
import { loadRuntimeState, saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import { createTeamMemberErrorHandler } from "./team-member-error-handler"

const temporaryDirectories: string[] = []

async function createTemporaryBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-member-error-handler-"))
  temporaryDirectories.push(baseDir)
  return baseDir
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function createRuntimeState(teamRunId: string): RuntimeState {
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
        status: "running",
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

async function seedRuntimeState(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  await mkdir(path.join(config.base_dir ?? "", "runtime", runtimeState.teamRunId), { recursive: true })
  await saveRuntimeState(runtimeState, config)
}

afterEach(async () => {
  clearTeamSessionRegistry()
  await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
    await rm(directoryPath, { recursive: true, force: true })
  }))
})

describe("createTeamMemberErrorHandler", () => {
  test("marks the matching member errored without changing team status", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId), config)
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("boom") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.status).toBe("active")
    expect(runtimeState.members[0]?.status).toBe("errored")
  })

  test("marks the member errored during the spawn race when the registry tracks the fresh session before disk state persists it", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState({
      ...createRuntimeState(teamRunId),
      members: [
        {
          name: "worker",
          agentType: "general-purpose",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
    }, config)
    registerTeamSession("member-session", {
      teamRunId,
      memberName: "worker",
      role: "member",
    })
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("boom") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.status).toBe("active")
    expect(runtimeState.members[0]?.status).toBe("errored")
  })

  test("falls back to disk lookup when the registry points the member session at the wrong teamRunId", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const correctTeamRunId = randomUUID()
    const wrongTeamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(correctTeamRunId), config)
    await seedRuntimeState({
      ...createRuntimeState(wrongTeamRunId),
      members: [
        {
          name: "worker",
          sessionId: "other-session",
          agentType: "general-purpose",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
    }, config)
    registerTeamSession("member-session", {
      teamRunId: wrongTeamRunId,
      memberName: "worker",
      role: "member",
    })
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("boom") },
      },
    })

    // then
    const correctRuntimeState = await loadRuntimeState(correctTeamRunId, config)
    const wrongRuntimeState = await loadRuntimeState(wrongTeamRunId, config)
    expect(correctRuntimeState.members[0]?.status).toBe("errored")
    expect(wrongRuntimeState.members[0]?.status).toBe("running")
  })
})

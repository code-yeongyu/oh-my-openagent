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
import type { RuntimeState, RuntimeStateMember } from "../../features/team-mode/types"
import { loadRuntimeState, saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import { createTeamMemberStatusHandler } from "./team-member-status-handler"

const temporaryDirectories: string[] = []

async function createTemporaryBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-member-status-handler-"))
  temporaryDirectories.push(baseDir)
  return baseDir
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function buildMember(overrides?: Partial<RuntimeStateMember>): RuntimeStateMember {
  return {
    name: "worker",
    sessionId: "member-session",
    agentType: "general-purpose",
    status: "running",
    pendingInjectedMessageIds: [],
    ...overrides,
  }
}

function createRuntimeState(teamRunId: string, member: RuntimeStateMember = buildMember()): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [member],
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

describe("createTeamMemberStatusHandler", () => {
  test("transitions a running member to idle when its session becomes idle", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ status: "running" })), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.idle", properties: { sessionID: "member-session" } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("idle")
  })

  test("leaves an already-idle member untouched on a subsequent session.idle", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ status: "idle" })), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.idle", properties: { sessionID: "member-session" } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("idle")
  })

  test("never overrides a terminal errored status on session.idle", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ status: "errored" })), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.idle", properties: { sessionID: "member-session" } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("errored")
  })

  test("marks a running member completed when its session is deleted", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ status: "running" })), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.deleted", properties: { info: { id: "member-session" } } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("completed")
  })

  test("marks an idle member completed when its session is deleted", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ status: "idle" })), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.deleted", properties: { info: { id: "member-session" } } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("completed")
  })

  test("preserves a terminal errored status even when the session is deleted", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ status: "errored" })), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.deleted", properties: { info: { id: "member-session" } } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("errored")
  })

  test("ignores session.idle events for sessions that are not team members", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId), config)
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.idle", properties: { sessionID: "unknown-session" } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("running")
  })

  test("ignores session.deleted events when the deleted session is the team lead", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId), config)
    registerTeamSession("lead-session", { teamRunId, memberName: "lead", role: "lead" })
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.deleted", properties: { info: { id: "lead-session" } } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("running")
  })

  test("uses the in-memory registry to recognize a fresh session during the spawn race", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId, buildMember({ sessionId: undefined, status: "running" })), config)
    registerTeamSession("member-session", { teamRunId, memberName: "worker", role: "member" })
    const handler = createTeamMemberStatusHandler(config)

    // when
    await handler({ event: { type: "session.idle", properties: { sessionID: "member-session" } } })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("idle")
  })
})

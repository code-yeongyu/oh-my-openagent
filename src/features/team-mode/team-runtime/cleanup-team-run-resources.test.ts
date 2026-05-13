/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import {
  clearTeamSessionRegistry,
  lookupTeamSession,
  registerTeamSession,
} from "../team-session-registry"
import { saveRuntimeState } from "../team-state-store/store"
import type { RuntimeState } from "../types"
import { cleanupTeamRunResources } from "./cleanup-team-run-resources"

const temporaryDirectories: string[] = []

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
    status: "creating",
    leadSessionId: "lead-session",
    members: [
      { name: "worker-1", agentType: "general-purpose", status: "pending", pendingInjectedMessageIds: [] },
    ],
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10_000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
  }
}

function createStubBgMgr(): BackgroundManager {
  return {
    cancelTask: async () => undefined,
  } as unknown as BackgroundManager
}

describe("cleanupTeamRunResources", () => {
  afterEach(async () => {
    clearTeamSessionRegistry()
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => rm(directoryPath, { recursive: true, force: true })))
  })

  test("unregisters every team-session-registry entry for the failed team so the gating hook cannot authorize stale participants", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-registry-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "33333333-3333-4333-8333-333333333333"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(createRuntimeState(teamRunId), createConfig(baseDir))
    registerTeamSession("lead-session", { teamRunId, memberName: "lead", role: "lead" })
    registerTeamSession("worker-session", { teamRunId, memberName: "worker-1", role: "member" })
    registerTeamSession("other-team-session", { teamRunId: "other-team", memberName: "solo", role: "member" })

    // when
    await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{}],
      bgMgr: createStubBgMgr(),
      createdLayout: false,
    })

    // then
    expect(lookupTeamSession("lead-session")).toBeUndefined()
    expect(lookupTeamSession("worker-session")).toBeUndefined()
    expect(lookupTeamSession("other-team-session")).toEqual({ teamRunId: "other-team", memberName: "solo", role: "member" })
  })
})

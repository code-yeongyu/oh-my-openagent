/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import * as layoutModule from "../team-layout-tmux/layout"
import {
  clearTeamSessionRegistry,
  lookupTeamSession,
  registerTeamSession,
} from "../team-session-registry"
import { saveRuntimeState } from "../team-state-store/store"
import type { RuntimeState } from "../types"
import { cleanupTeamRunResources } from "./cleanup-team-run-resources"
import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"

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
  return unsafeTestValue<BackgroundManager>({
    cancelTaskForCleanup: async () => undefined,
  })
}

describe("cleanupTeamRunResources", () => {
  afterEach(async () => {
    mock.restore()
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

  test("uses persisted pane IDs for rollback layout cleanup so caller tmux windows are not killed", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-layout-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "44444444-4444-4444-8444-444444444444"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        focusWindowId: "test-session:0",
        paneIds: ["%10", "%11"],
      },
    }, createConfig(baseDir))
    const removeTeamLayoutSpy = spyOn(layoutModule, "removeTeamLayout").mockResolvedValue(undefined)

    // when
    await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{}],
      bgMgr: createStubBgMgr(),
      tmuxMgr: { getServerUrl: () => "http://127.0.0.1:12345" } as never,
      createdLayout: true,
    })

    // then
    expect(removeTeamLayoutSpy).toHaveBeenCalledWith(teamRunId, {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "test-session:0",
      paneIds: ["%10", "%11"],
    }, expect.anything())
  })

  test("falls back to member pane IDs for rollback cleanup when older runtime state lacks layout paneIds", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-layout-legacy-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "55555555-5555-4555-8555-555555555555"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        focusWindowId: "test-session:0",
      },
      members: [
        { name: "lead", agentType: "leader", tmuxPaneId: "%0", status: "running", pendingInjectedMessageIds: [] },
        { name: "worker-1", agentType: "general-purpose", tmuxPaneId: "%10", tmuxGridPaneId: "%11", status: "running", pendingInjectedMessageIds: [] },
      ],
    }, createConfig(baseDir))
    const removeTeamLayoutSpy = spyOn(layoutModule, "removeTeamLayout").mockResolvedValue(undefined)

    // when
    await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{}],
      bgMgr: createStubBgMgr(),
      tmuxMgr: { getServerUrl: () => "http://127.0.0.1:12345" } as never,
      createdLayout: true,
    })

    // then
    expect(removeTeamLayoutSpy).toHaveBeenCalledWith(teamRunId, {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "test-session:0",
      paneIds: ["%10", "%11"],
    }, expect.anything())
  })
})

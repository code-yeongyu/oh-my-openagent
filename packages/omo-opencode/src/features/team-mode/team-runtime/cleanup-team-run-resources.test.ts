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
import { listActiveTeams, loadRuntimeState, saveRuntimeState } from "../team-state-store/store"
import type { RuntimeState } from "../types"
import { cleanupTeamRunResources } from "./cleanup-team-run-resources"
import { deleteTeam } from "./delete-team"
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
    cancelTask: async () => true,
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
      resources: [{ memberName: "worker-1" }],
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
        paneIds: ["%10"],
      },
      members: [
        { name: "lead", agentType: "leader", tmuxPaneId: "%0", status: "running", pendingInjectedMessageIds: [] },
        { name: "worker-1", agentType: "general-purpose", tmuxPaneId: "%10", tmuxGridPaneId: "%11", status: "running", pendingInjectedMessageIds: [] },
      ],
    }, createConfig(baseDir))
    const removeTeamLayoutSpy = spyOn(layoutModule, "removeTeamLayout").mockResolvedValue({
      attemptedPaneIds: ["%10", "%11"],
      removedPaneIds: ["%10", "%11"],
      skippedPaneIds: [],
      reason: "removed",
    })

    // when
    await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1" }],
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
    const persistedState = await loadRuntimeState(teamRunId, createConfig(baseDir))
    expect(persistedState.status).toBe("failed")
    expect(persistedState.layoutCleanupPending).toBeUndefined()
    expect(persistedState.tmuxLayout).toBeUndefined()
    expect(persistedState.members.every((member) => (
      member.tmuxPaneId === undefined && member.tmuxGridPaneId === undefined
    ))).toBe(true)
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
    const removeTeamLayoutSpy = spyOn(layoutModule, "removeTeamLayout").mockResolvedValue({
      attemptedPaneIds: ["%10", "%11"],
      removedPaneIds: ["%10", "%11"],
      skippedPaneIds: [],
      reason: "removed",
    })

    // when
    await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1", taskId: "task-worker-1" }],
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

  test("reports a partial layout cleanup instead of claiming the layout was removed", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-layout-partial-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "66666666-6666-4666-8666-666666666666"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%10", "%11"],
      },
    }, createConfig(baseDir))
    let stateObservedBeforeLayoutCleanup: RuntimeState | undefined
    spyOn(layoutModule, "removeTeamLayout").mockImplementation(async () => {
      stateObservedBeforeLayoutCleanup = await loadRuntimeState(teamRunId, createConfig(baseDir))
      return {
        attemptedPaneIds: ["%10", "%11"],
        removedPaneIds: ["%10"],
        skippedPaneIds: ["%11"],
        reason: "partial",
      }
    })

    const report = await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1", taskId: "task-worker-1" }],
      bgMgr: createStubBgMgr(),
      tmuxMgr: { getServerUrl: () => "http://127.0.0.1:12345" } as never,
      createdLayout: true,
    })

    expect(report.removedLayout).toBe(false)
    expect(report.errors).toContain(`layout ${teamRunId}: cleanup partial; skipped 1 pane(s)`)
    expect(stateObservedBeforeLayoutCleanup?.status).toBe("deleting")
    expect(stateObservedBeforeLayoutCleanup?.layoutCleanupPending).toBe(true)

    const persistedState = await loadRuntimeState(teamRunId, createConfig(baseDir))
    expect(persistedState.status).toBe("deleting")
    expect(persistedState.layoutCleanupPending).toBe(true)
    expect(persistedState.tmuxLayout?.paneIds).toEqual(["%11"])
    expect(persistedState.tmuxLayout?.targetSessionId).toBe("$caller")
    expect(persistedState.members[0]?.status).toBe("errored")
    expect(await listActiveTeams(createConfig(baseDir))).toEqual([{
      teamRunId,
      teamName: "team-alpha",
      status: "deleting",
      memberCount: 1,
      scope: "project",
      leadSessionId: "lead-session",
    }])

    const retryRemoveLayout = mock(async () => ({
      attemptedPaneIds: ["%11"],
      removedPaneIds: ["%11"],
      skippedPaneIds: [],
      reason: "removed" as const,
    }))
    const retryResult = await deleteTeam(
      teamRunId,
      createConfig(baseDir),
      { getServerUrl: () => "http://127.0.0.1:12345" } as never,
      unsafeTestValue({ getTasksByParentSession: () => [], cancelTask: async () => undefined }),
      undefined,
      {
        canVisualize: () => false,
        removeTeamLayout: retryRemoveLayout,
        log: () => undefined,
      },
    )
    expect(retryResult.removedLayout).toBe(true)
    expect(retryRemoveLayout).toHaveBeenCalledWith(teamRunId, expect.objectContaining({
      paneIds: ["%11"],
    }), expect.anything())
    await expect(loadRuntimeState(teamRunId, createConfig(baseDir))).rejects.toThrow()
  })

  test("preserves every layout recovery reference when the tmux manager is unavailable", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-layout-unavailable-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "77777777-7777-4777-8777-777777777777"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%10", "%11"],
      },
      members: [
        { name: "worker-1", agentType: "general-purpose", tmuxPaneId: "%10", status: "running", pendingInjectedMessageIds: [] },
      ],
    }, createConfig(baseDir))

    const report = await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1" }],
      bgMgr: createStubBgMgr(),
      createdLayout: true,
    })

    const persistedState = await loadRuntimeState(teamRunId, createConfig(baseDir))
    expect(report.removedLayout).toBe(false)
    expect(report.errors).toContain(`layout ${teamRunId}: tmux manager unavailable`)
    expect(persistedState.status).toBe("deleting")
    expect(persistedState.layoutCleanupPending).toBe(true)
    expect(persistedState.tmuxLayout?.paneIds).toEqual(["%10", "%11"])
    expect(persistedState.members[0]?.tmuxPaneId).toBe("%10")
  })

  test("keeps the pre-marked recovery state when layout cleanup throws", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-layout-throw-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "88888888-8888-4888-8888-888888888888"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%12"],
      },
    }, createConfig(baseDir))
    spyOn(layoutModule, "removeTeamLayout").mockRejectedValue(new Error("tmux transport failed"))

    const report = await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1" }],
      bgMgr: createStubBgMgr(),
      tmuxMgr: { getServerUrl: () => "http://127.0.0.1:12345" } as never,
      createdLayout: true,
    })

    const persistedState = await loadRuntimeState(teamRunId, createConfig(baseDir))
    expect(report.errors).toContain(`layout ${teamRunId}: tmux transport failed`)
    expect(persistedState.status).toBe("deleting")
    expect(persistedState.layoutCleanupPending).toBe(true)
    expect(persistedState.tmuxLayout?.paneIds).toEqual(["%12"])
  })

  test("keeps a member active when task cancellation fails", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-cancel-failed-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "99999999-9999-4999-8999-999999999999"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      members: [
        { name: "worker-1", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] },
      ],
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%13"],
      },
    }, createConfig(baseDir))
    let stateObservedDuringCancellation: RuntimeState | undefined
    const bgMgr = unsafeTestValue<BackgroundManager>({
      cancelTask: async () => {
        stateObservedDuringCancellation = await loadRuntimeState(teamRunId, createConfig(baseDir))
        throw new Error("cancel failed")
      },
    })

    const report = await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1", taskId: "task-worker-1" }],
      bgMgr,
      createdLayout: true,
    })

    const persistedState = await loadRuntimeState(teamRunId, createConfig(baseDir))
    expect(stateObservedDuringCancellation?.status).toBe("deleting")
    expect(stateObservedDuringCancellation?.layoutCleanupPending).toBe(true)
    expect(report.errors).toContain("cancel task-worker-1: cancel failed")
    expect(persistedState.status).toBe("deleting")
    expect(persistedState.members[0]?.status).toBe("running")
  })

  test("keeps a member active when task cancellation returns false", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "cleanup-team-run-cancel-incomplete-"))
    temporaryDirectories.push(baseDir)
    const teamRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState({
      ...createRuntimeState(teamRunId),
      members: [
        { name: "worker-1", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] },
      ],
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%14"],
      },
    }, createConfig(baseDir))
    const bgMgr = unsafeTestValue<BackgroundManager>({ cancelTask: async () => false })

    const report = await cleanupTeamRunResources({
      teamRunId,
      config: createConfig(baseDir),
      resources: [{ memberName: "worker-1", taskId: "task-worker-1" }],
      bgMgr,
      createdLayout: true,
    })

    const persistedState = await loadRuntimeState(teamRunId, createConfig(baseDir))
    expect(report.cancelledTaskIds).toEqual([])
    expect(report.errors).toContain("cancel task-worker-1: task remained active")
    expect(persistedState.status).toBe("deleting")
    expect(persistedState.members[0]?.status).toBe("running")
  })
})

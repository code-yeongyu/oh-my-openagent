/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { access, mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import * as runtimeStateStore from "../team-state-store/store"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import type { DeleteTeamDeps } from "./delete-team"
import { deleteTeam } from "./shutdown"
import { createFixture, updateMemberStatuses } from "./shutdown-test-fixtures"

describe("team-runtime force cleanup", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
    mock.restore()
  })

  test("deletes team even with active members when force=true", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "running",
    })
    await Promise.all(fixture.worktreePaths.map(async (worktreePath) => {
      await mkdir(worktreePath, { recursive: true })
    }))

    // when
    const result = await deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

    // then
    expect(result.removedLayout).toBe(false)
    expect(result.removedWorktrees.sort()).toEqual([...fixture.worktreePaths].sort())
    await Promise.all(fixture.worktreePaths.map(async (worktreePath) => {
      await access(worktreePath).then(
        () => { throw new Error(`expected ${worktreePath} to be removed`) },
        () => undefined,
      )
    }))
    const runtimeStateDirectory = getRuntimeStateDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await access(runtimeStateDirectory).then(
      () => { throw new Error(`expected ${runtimeStateDirectory} to be removed`) },
      () => undefined,
    )
  })

  test("force deletes a team stuck in 'creating' status", async () => {
    // given
    const fixture = await createFixture({ status: "creating" })
    temporaryDirectories.push(fixture.baseDir)
    const transitionedStatuses: string[] = []
    const originalTransitionRuntimeState = runtimeStateStore.transitionRuntimeState
    spyOn(runtimeStateStore, "transitionRuntimeState").mockImplementation(async (teamRunId, transition, config) => {
      const currentRuntimeState = await runtimeStateStore.loadRuntimeState(teamRunId, config)
      transitionedStatuses.push(transition(currentRuntimeState).status)
      return await originalTransitionRuntimeState(teamRunId, transition, config)
    })
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "pending",
      "member-b": "pending",
    })

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

    // then
    expect(transitionedStatuses).toContain("deleted")
    const runtimeStateDirectory = getRuntimeStateDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await access(runtimeStateDirectory).then(
      () => { throw new Error(`expected ${runtimeStateDirectory} to be removed`) },
      () => undefined,
    )
  })

  test("force deletes a team in 'orphaned' status", async () => {
    // given
    const fixture = await createFixture({ status: "orphaned" })
    temporaryDirectories.push(fixture.baseDir)
    const transitionedStatuses: string[] = []
    const originalTransitionRuntimeState = runtimeStateStore.transitionRuntimeState
    spyOn(runtimeStateStore, "transitionRuntimeState").mockImplementation(async (teamRunId, transition, config) => {
      const currentRuntimeState = await runtimeStateStore.loadRuntimeState(teamRunId, config)
      transitionedStatuses.push(transition(currentRuntimeState).status)
      return await originalTransitionRuntimeState(teamRunId, transition, config)
    })
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "running",
    })

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

    // then
    expect(transitionedStatuses).toContain("deleted")
    const runtimeStateDirectory = getRuntimeStateDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await access(runtimeStateDirectory).then(
      () => { throw new Error(`expected ${runtimeStateDirectory} to be removed`) },
      () => undefined,
    )
  })

  test("force removes lead member worktree if present", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    const leadWorktreePath = path.join(fixture.baseDir, "fixture-worktrees", "lead")
    await transitionRuntimeState(fixture.teamRunId, (runtimeState) => ({
      ...runtimeState,
      members: runtimeState.members.map((member) => member.name === "lead"
        ? { ...member, worktreePath: leadWorktreePath }
        : member),
    }), fixture.config)
    await mkdir(leadWorktreePath, { recursive: true })
    await Promise.all(fixture.worktreePaths.map(async (worktreePath) => {
      await mkdir(worktreePath, { recursive: true })
    }))
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "running",
    })

    // when
    const result = await deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

    // then
    expect(result.removedWorktrees.sort()).toEqual([leadWorktreePath, ...fixture.worktreePaths].sort())
    await access(leadWorktreePath).then(
      () => { throw new Error(`expected ${leadWorktreePath} to be removed`) },
      () => undefined,
    )
  })

  test("force continues cleanup when removeTeamLayout throws", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    const transitionedStatuses: string[] = []
    const originalTransitionRuntimeState = runtimeStateStore.transitionRuntimeState
    spyOn(runtimeStateStore, "transitionRuntimeState").mockImplementation(async (teamRunId, transition, config) => {
      const currentRuntimeState = await runtimeStateStore.loadRuntimeState(teamRunId, config)
      transitionedStatuses.push(transition(currentRuntimeState).status)
      return await originalTransitionRuntimeState(teamRunId, transition, config)
    })
    const logMock = mock(() => {})
    const deps = {
      canVisualize: () => true,
      removeTeamLayout: async () => { throw new Error("layout failed") },
      log: logMock,
    } satisfies DeleteTeamDeps
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "idle",
    })
    await Promise.all(fixture.worktreePaths.map(async (worktreePath) => {
      await mkdir(worktreePath, { recursive: true })
    }))

    // when
    const result = await deleteTeam(
      fixture.teamRunId,
      { ...fixture.config, tmux_visualization: true },
      { getServerUrl: () => "http://localhost" } as never,
      undefined,
      { force: true },
      deps,
    )

    // then
    expect(result.removedLayout).toBe(true)
    expect(transitionedStatuses).toContain("deleted")
    expect(logMock).toHaveBeenCalledWith("team delete layout cleanup failed", {
      teamRunId: fixture.teamRunId,
      error: "layout failed",
    })
    const runtimeStateDirectory = getRuntimeStateDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await access(runtimeStateDirectory).then(
      () => { throw new Error(`expected ${runtimeStateDirectory} to be removed`) },
      () => undefined,
    )
  })

  test("#given tmux manager but visualization disabled #when deleteTeam runs #then layout cleanup is skipped", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    const removeLayoutMock = mock(async () => {})
    const deps = {
      canVisualize: () => true,
      removeTeamLayout: removeLayoutMock,
      log: () => {},
    } satisfies DeleteTeamDeps
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "completed",
    })

    // when
    const result = await deleteTeam(
      fixture.teamRunId,
      { ...fixture.config, tmux_visualization: false },
      { getServerUrl: () => "http://localhost" } as never,
      undefined,
      undefined,
      deps,
    )

    // then
    expect(result.removedLayout).toBe(false)
    expect(removeLayoutMock).not.toHaveBeenCalled()
  })

  test("cancels team background tasks before deleting when force=true", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "idle",
    })
    const runtimeStatusesDuringCancellation: Array<{ teamStatus: string; memberStatuses: string[] }> = []
    const cancelTaskMock = mock(async () => {
      const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
      runtimeStatusesDuringCancellation.push({
        teamStatus: runtimeState.status,
        memberStatuses: runtimeState.members
          .filter((member) => member.agentType !== "leader")
          .map((member) => member.status),
      })
      return true
    })
    const bgMgr = {
      getTasksByParentSession: () => [
        { id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` },
        { id: "team-task-b", sessionId: "session-b", parentMessageId: `team-create:${fixture.teamRunId}:member-b` },
      ],
      cancelTask: cancelTaskMock,
    }

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr as never, { force: true })

    // then
    expect(cancelTaskMock).toHaveBeenCalledTimes(2)
    expect(runtimeStatusesDuringCancellation).toEqual([
      { teamStatus: "active", memberStatuses: ["running", "idle"] },
      { teamStatus: "active", memberStatuses: ["running", "idle"] },
    ])
  })
})

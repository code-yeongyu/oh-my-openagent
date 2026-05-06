/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { access, mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { sendMessage } from "../team-mailbox/send"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import * as logger from "../../../shared/logger"
import * as layoutModule from "../team-layout-tmux/layout"
import * as runtimeStateStore from "../team-state-store/store"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import {
  createFixture,
  createTestMessage,
  readInboxMessages,
  updateMemberStatuses,
} from "./shutdown-test-fixtures"

const { approveShutdown, deleteTeam, rejectShutdown, requestShutdownOfMember } = await import("./shutdown")

describe("team-runtime shutdown", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
    mock.restore()
  })

  test("refuses team deletion while non-lead members are still active", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "running",
    })

    // when
    const result = deleteTeam(fixture.teamRunId, fixture.config)

    // then
    await result.then(
      () => { throw new Error("expected deleteTeam to reject") },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error
        expect(error.message).toBe("members still active")
      },
    )
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    expect(runtimeState.status).toBe("active")
    expect(runtimeState.members.filter((member) => member.agentType !== "leader").map((member) => member.status)).toEqual([
      "running",
      "running",
    ])
  })

  test("writes shutdown requests to the target inbox and records runtime metadata", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)

    // when
    await requestShutdownOfMember(fixture.teamRunId, "member-a", "lead", fixture.config)

    // then
    const inboxMessages = await readInboxMessages(fixture.teamRunId, "member-a", fixture.config)
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    expect(inboxMessages).toHaveLength(1)
    expect(inboxMessages[0]).toEqual(expect.objectContaining({
      from: "lead",
      to: "member-a",
      kind: "shutdown_request",
      body: "",
    }))
    expect(runtimeState.shutdownRequests).toEqual([
      expect.objectContaining({
        memberId: "member-a",
        requesterName: "lead",
        requestedAt: expect.any(Number),
      }),
    ])
  })

  test("approves shutdown requests and notifies the lead", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await requestShutdownOfMember(fixture.teamRunId, "member-a", "lead", fixture.config)

    // when
    await approveShutdown(fixture.teamRunId, "member-a", "member-a", fixture.config)

    // then
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    const leadInboxMessages = await readInboxMessages(fixture.teamRunId, "lead", fixture.config)
    const approvedRequest = runtimeState.shutdownRequests.find((shutdownRequest) => shutdownRequest.memberId === "member-a")
    expect(approvedRequest?.approvedAt).toEqual(expect.any(Number))
    expect(runtimeState.members.find((member) => member.name === "member-a")?.status).toBe("shutdown_approved")
    expect(leadInboxMessages.some((message) => (
      message.kind === "shutdown_approved"
      && message.from === "member-a"
      && message.to === "lead"
      && message.body === "member-a"
    ))).toBe(true)
  })

  test("rejects shutdown requests and replies to the original requester", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await requestShutdownOfMember(fixture.teamRunId, "member-a", "lead", fixture.config)

    // when
    await rejectShutdown(fixture.teamRunId, "member-a", "not done yet", fixture.config)

    // then
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    const leadInboxMessages = await readInboxMessages(fixture.teamRunId, "lead", fixture.config)
    const rejectedRequest = runtimeState.shutdownRequests.find((shutdownRequest) => shutdownRequest.memberId === "member-a")
    expect(rejectedRequest).toEqual(expect.objectContaining({
      rejectedAt: expect.any(Number),
      rejectedReason: "not done yet",
    }))
    expect(leadInboxMessages.some((message) => (
      message.kind === "shutdown_rejected"
      && message.from === "member-a"
      && message.to === "lead"
      && message.body === "not done yet"
    ))).toBe(true)
  })

  test("deletes team runtime resources after all non-lead members are approved", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })
    await Promise.all(fixture.worktreePaths.map(async (worktreePath) => {
      await mkdir(worktreePath, { recursive: true })
    }))
    // when
    const result = await deleteTeam(fixture.teamRunId, fixture.config)

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
    spyOn(layoutModule, "canVisualize").mockReturnValue(true)
    spyOn(layoutModule, "removeTeamLayout").mockRejectedValue(new Error("layout failed"))
    const logSpy = spyOn(logger, "log").mockImplementation(() => {})
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
    )

    // then
    expect(result.removedLayout).toBe(true)
    expect(transitionedStatuses).toContain("deleted")
    expect(logSpy).toHaveBeenCalledWith("team delete layout cleanup failed", {
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
    spyOn(layoutModule, "canVisualize").mockReturnValue(true)
    const removeLayoutSpy = spyOn(layoutModule, "removeTeamLayout").mockResolvedValue(undefined)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "completed",
    })

    // when
    const result = await deleteTeam(
      fixture.teamRunId,
      { ...fixture.config, tmux_visualization: false },
      { getServerUrl: () => "http://localhost" } as never,
    )

    // then
    expect(result.removedLayout).toBe(false)
    expect(removeLayoutSpy).not.toHaveBeenCalled()
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

  test("blocks mailbox writes while the team is deleting", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })
    await transitionRuntimeState(fixture.teamRunId, (runtimeState) => ({
      ...runtimeState,
      status: "deleting",
    }), fixture.config)

    // when
    const result = sendMessage(
      createTestMessage(),
      fixture.teamRunId,
      fixture.config,
      { isLead: true, activeMembers: ["lead", "member-a", "member-b"] },
    )

    // then
    await result.then(
      () => { throw new Error("expected sendMessage to reject") },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error
        expect(error.message).toBe("team is deleting")
      },
    )
  })
})

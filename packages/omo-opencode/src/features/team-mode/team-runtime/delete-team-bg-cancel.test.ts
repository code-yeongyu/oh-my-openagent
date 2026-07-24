/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { rm } from "node:fs/promises"

import type { BackgroundTask } from "../../background-agent/types"
import { deleteTeam, type DeleteTeamBackgroundManager } from "./delete-team"
import { createFixture, updateMemberStatuses } from "./shutdown-test-fixtures"

type BackgroundTaskInput = Pick<BackgroundTask, "id" | "sessionId" | "teamRunId"> & {
  parentMessageId?: string
}

function createBackgroundTask(input: BackgroundTaskInput): BackgroundTask {
  return {
    ...input,
    parentMessageId: input.parentMessageId ?? "delegate-task:test-task",
    parentSessionId: "lead-session",
    description: "test task",
    prompt: "test prompt",
    agent: "sisyphus",
    status: "running",
  }
}

describe("deleteTeam cancels only this team's background tasks", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("uses leadSessionId as the getTasksByParentSession key when force deleting", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })

    const getTasksByParentSessionMock = mock((sessionId: string) => {
      if (sessionId !== "lead-session") return []
      return [
        createBackgroundTask({ id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` }),
        createBackgroundTask({ id: "team-task-b", sessionId: "session-b", parentMessageId: `team-create:${fixture.teamRunId}:member-b` }),
      ]
    })
    const cancelTaskMock = mock(async (_taskId: string, _options?: Parameters<DeleteTeamBackgroundManager["cancelTaskForCleanup"]>[1]) => true)
    const bgMgr = {
      getTasksByParentSession: getTasksByParentSessionMock,
      cancelTaskForCleanup: cancelTaskMock,
    } satisfies DeleteTeamBackgroundManager

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr, { force: true })

    // then
    expect(getTasksByParentSessionMock).toHaveBeenCalledTimes(1)
    expect(getTasksByParentSessionMock).toHaveBeenCalledWith("lead-session")
    expect(cancelTaskMock).toHaveBeenCalledTimes(2)
    const firstCall = cancelTaskMock.mock.calls[0]
    const secondCall = cancelTaskMock.mock.calls[1]
    expect(firstCall?.[0]).toBe("team-task-a")
    expect(secondCall?.[0]).toBe("team-task-b")
  })

  test("does not cancel background tasks when non-force delete rejects active members", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)

    const getTasksByParentSessionMock = mock(() => [
      createBackgroundTask({ id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` }),
    ])
    const cancelTaskMock = mock(async (_taskId: string, _options?: Parameters<DeleteTeamBackgroundManager["cancelTaskForCleanup"]>[1]) => true)
    const bgMgr = {
      getTasksByParentSession: getTasksByParentSessionMock,
      cancelTaskForCleanup: cancelTaskMock,
    } satisfies DeleteTeamBackgroundManager

    // when
    let thrownError: unknown
    try {
      await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr)
    } catch (error) {
      thrownError = error
    }

    // then
    if (!(thrownError instanceof Error)) {
      throw new Error("deleteTeam should reject active members")
    }
    expect(thrownError.message).toContain("members still active")
    expect(getTasksByParentSessionMock).not.toHaveBeenCalled()
    expect(cancelTaskMock).not.toHaveBeenCalled()
  })

  test("does not cancel active background tasks after shutdown approval without force", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })
    const getTasksByParentSessionMock = mock(() => [
      createBackgroundTask({ id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` }),
    ])
    const cancelTaskMock = mock(async (_taskId: string, _options?: Parameters<DeleteTeamBackgroundManager["cancelTaskForCleanup"]>[1]) => true)
    const bgMgr = {
      getTasksByParentSession: getTasksByParentSessionMock,
      cancelTaskForCleanup: cancelTaskMock,
    } satisfies DeleteTeamBackgroundManager

    // when
    let errorMessage = ""
    try {
      await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr)
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(errorMessage).toBe("members still active")
    expect(getTasksByParentSessionMock).toHaveBeenCalledTimes(1)
    expect(cancelTaskMock).not.toHaveBeenCalled()
  })

  test("leaves unrelated sibling tasks on the same lead session alive when force deleting", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })

    const getTasksByParentSessionMock = mock(() => [
      createBackgroundTask({ id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` }),
      createBackgroundTask({ id: "delegate-task-x", sessionId: "session-x", parentMessageId: "delegate-task:plan-refactor" }),
      createBackgroundTask({ id: "background-task-y", sessionId: "session-y", parentMessageId: "delegate-task:background-task-y" }),
      createBackgroundTask({ id: "team-task-other", sessionId: "session-other", parentMessageId: "team-create:other-team-id:member-a" }),
    ])
    const cancelTaskMock = mock(async (_taskId: string, _options?: Parameters<DeleteTeamBackgroundManager["cancelTaskForCleanup"]>[1]) => true)
    const bgMgr = {
      getTasksByParentSession: getTasksByParentSessionMock,
      cancelTaskForCleanup: cancelTaskMock,
    } satisfies DeleteTeamBackgroundManager

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr, { force: true })

    // then
    expect(cancelTaskMock).toHaveBeenCalledTimes(1)
    const cancelledTaskId = cancelTaskMock.mock.calls[0]?.[0]
    expect(cancelledTaskId).toBe("team-task-a")
  })
})

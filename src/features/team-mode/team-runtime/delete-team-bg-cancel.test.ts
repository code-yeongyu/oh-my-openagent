/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { rm } from "node:fs/promises"

import type { BackgroundManager } from "../../background-agent/manager"
import { createFixture, updateMemberStatuses } from "./shutdown-test-fixtures"

const { deleteTeam } = await import("./delete-team")

describe("deleteTeam cancels only this team's background tasks", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("uses leadSessionId as the getTasksByParentSession key", async () => {
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
        { id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` },
        { id: "team-task-b", sessionId: "session-b", parentMessageId: `team-create:${fixture.teamRunId}:member-b` },
      ]
    })
    const cancelTaskMock = mock(async () => true)
    const bgMgr = {
      getTasksByParentSession: getTasksByParentSessionMock,
      cancelTask: cancelTaskMock,
    } as BackgroundManager

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr)

    // then
    expect(getTasksByParentSessionMock).toHaveBeenCalledTimes(1)
    expect(getTasksByParentSessionMock).toHaveBeenCalledWith("lead-session")
    expect(cancelTaskMock).toHaveBeenCalledTimes(2)
    const firstCall = cancelTaskMock.mock.calls[0]
    const secondCall = cancelTaskMock.mock.calls[1]
    expect(firstCall?.[0]).toBe("team-task-a")
    expect(secondCall?.[0]).toBe("team-task-b")
  })

  test("leaves unrelated sibling tasks on the same lead session alive", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })

    const getTasksByParentSessionMock = mock(() => [
      { id: "team-task-a", sessionId: "session-a", parentMessageId: `team-create:${fixture.teamRunId}:member-a` },
      { id: "delegate-task-x", sessionId: "session-x", parentMessageId: "delegate-task:plan-refactor" },
      { id: "background-task-y", sessionId: "session-y", parentMessageId: undefined },
      { id: "team-task-other", sessionId: "session-other", parentMessageId: "team-create:other-team-id:member-a" },
    ])
    const cancelTaskMock = mock(async () => true)
    const bgMgr = {
      getTasksByParentSession: getTasksByParentSessionMock,
      cancelTask: cancelTaskMock,
    } as BackgroundManager

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr)

    // then
    expect(cancelTaskMock).toHaveBeenCalledTimes(1)
    const cancelledTaskId = cancelTaskMock.mock.calls[0]?.[0]
    expect(cancelledTaskId).toBe("team-task-a")
  })
})

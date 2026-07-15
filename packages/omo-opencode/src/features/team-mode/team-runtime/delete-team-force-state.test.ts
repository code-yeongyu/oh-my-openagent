/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { access, rm } from "node:fs/promises"

import type { BackgroundTask, BackgroundTaskStatus } from "../../background-agent/types"
import { deleteTeam } from "./delete-team"
import { createFixture, updateMemberStatuses } from "./shutdown-test-fixtures"

function createTeamTask(teamRunId: string, id: string, status: BackgroundTaskStatus): BackgroundTask {
  return {
    id,
    sessionId: `session-${id}`,
    teamRunId,
    parentMessageId: `team-create:${teamRunId}:member-a`,
    parentSessionId: "lead-session",
    description: id,
    prompt: id,
    agent: "sisyphus",
    status,
  }
}

describe("deleteTeam force cancellation state", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("treats terminal Team tasks as quiesced without cancelling them", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })
    const tasks = (["completed", "error", "cancelled", "interrupt"] as const)
      .map((status) => createTeamTask(fixture.teamRunId, `task-${status}`, status))
    const cancelTask = mock(async () => false)
    const bgMgr = {
      getTasksByParentSession: mock(() => tasks),
      cancelTask,
      getTask: (taskId: string) => tasks.find((task) => task.id === taskId),
    }

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr, { force: true })

    // then
    expect(cancelTask).not.toHaveBeenCalled()
  })

  test("continues force deletion when a false cancellation re-read is terminal", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    const task = createTeamTask(fixture.teamRunId, "task-active", "running")
    const cancelTask = mock(async () => {
      task.status = "completed"
      return false
    })
    const bgMgr = {
      getTasksByParentSession: mock(() => [task]),
      cancelTask,
      getTask: () => task,
    }

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr, { force: true })

    // then
    expect(cancelTask).toHaveBeenCalledTimes(1)
  })

  for (const stateAfterCancellation of ["active", "unknown"] as const) {
    test(`retains resources when a false cancellation re-read is ${stateAfterCancellation}`, async () => {
      // given
      const fixture = await createFixture()
      temporaryDirectories.push(fixture.baseDir)
      const task = createTeamTask(fixture.teamRunId, "task-active", "running")
      const bgMgr = {
        getTasksByParentSession: mock(() => [task]),
        cancelTask: mock(async () => false),
        getTask: () => stateAfterCancellation === "active" ? task : undefined,
      }

      // when
      const result = deleteTeam(fixture.teamRunId, fixture.config, undefined, bgMgr, { force: true })

      // then
      await expect(result).rejects.toThrow("cancellation was not confirmed")
      await expect(access(fixture.worktreePaths[0] ?? "")).resolves.toBeNull()
    })
  }
})

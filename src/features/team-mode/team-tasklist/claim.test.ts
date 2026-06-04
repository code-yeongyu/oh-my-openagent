/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"

import { getTasksDir, resolveBaseDir } from "../team-registry"
import { claimTask, AlreadyClaimedError, BlockedByError } from "./claim"
import { createTask } from "./store"
import { createTaskInput, createTasklistFixture } from "./test-support"
import { updateTaskStatus } from "./update"

test("claimTask allows exactly one concurrent claimant", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    const task = await createTask(fixture.teamRunId, createTaskInput(), fixture.config)

    // when
    const claimResults = await Promise.allSettled([
      claimTask(fixture.teamRunId, task.id, "member-a", fixture.config),
      claimTask(fixture.teamRunId, task.id, "member-b", fixture.config),
    ])

    const successfulClaims = claimResults.filter((result) => result.status === "fulfilled")
    const failedClaims = claimResults.filter((result) => result.status === "rejected")

    // then
    expect(successfulClaims).toHaveLength(1)
    expect(failedClaims).toHaveLength(1)
    expect(failedClaims[0]?.status).toBe("rejected")
    if (failedClaims[0]?.status === "rejected") {
      expect(failedClaims[0].reason).toBeInstanceOf(AlreadyClaimedError)
    }
  } finally {
    await fixture.cleanup()
  }
})

test("claimTask rejects blocked tasks until blockers complete", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    const blockerTask = await createTask(fixture.teamRunId, createTaskInput({ subject: "blocker" }), fixture.config)
    const blockedTask = await createTask(
      fixture.teamRunId,
      createTaskInput({ subject: "blocked", blockedBy: [blockerTask.id] }),
      fixture.config,
    )

    // when
    let blockedError: unknown = null
    try {
      await claimTask(fixture.teamRunId, blockedTask.id, "member-a", fixture.config)
    } catch (error) {
      blockedError = error
    }

    // then
    expect(blockedError).toBeInstanceOf(BlockedByError)

    // given
    await claimTask(fixture.teamRunId, blockerTask.id, "member-b", fixture.config)
    await updateTaskStatus(fixture.teamRunId, blockerTask.id, "in_progress", "member-b", fixture.config)
    await updateTaskStatus(fixture.teamRunId, blockerTask.id, "completed", "member-b", fixture.config)

    // when
    const claimedTask = await claimTask(fixture.teamRunId, blockedTask.id, "member-a", fixture.config)

    // then
    expect(claimedTask.status).toBe("claimed")
    expect(claimedTask.owner).toBe("member-a")
  } finally {
    await fixture.cleanup()
  }
})

test("claimTask reaps a stale claim lock before claiming", async () => {
  // given
  const fixture = await createTasklistFixture()

    try {
      const task = await createTask(fixture.teamRunId, createTaskInput(), fixture.config)
      const tasksDirectory = getTasksDir(resolveBaseDir(fixture.config), fixture.teamRunId)
      const staleLockPath = path.join(tasksDirectory, "claims", `${task.id}.lock`)
      await writeFile(staleLockPath, `member-z\n999999\n${Date.now() - 600_000}\n`)

    // when
    const claimedTask = await claimTask(fixture.teamRunId, task.id, "member-a", fixture.config)

    // then
    expect(claimedTask.status).toBe("claimed")
    expect(claimedTask.owner).toBe("member-a")
  } finally {
    await fixture.cleanup()
  }
})

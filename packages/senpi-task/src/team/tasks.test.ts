import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { toTeamCoreConfig, type TeamCoreConfig } from "./runtime-config"
import {
  TeamTaskAlreadyClaimedError,
  TeamTaskBlockedByError,
  TeamTaskCrossOwnerUpdateError,
  TeamTaskInvalidTransitionError,
  canClaimTeamTask,
  claimTeamTask,
  createTeamTask,
  getTeamTask,
  listTeamTasks,
  updateTeamTaskStatus,
  type TeamTasklistContext,
} from "./tasks"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempContext(): TeamTasklistContext {
  const dir = mkdtempSync(join(tmpdir(), "senpi-team-tasks-"))
  cleanupRoots.push(dir)
  const config: TeamCoreConfig = toTeamCoreConfig(OmoTaskSettingsSchema.parse({}), dir)
  return { teamRunId: "team-run-tasks", config }
}

describe("team tasklist orchestration", { timeout: 15_000 }, () => {
  test("#given a task input #when createTeamTask runs #then it persists a pending task with an id", async () => {
    // given
    const ctx = tempContext()

    // when
    const task = await createTeamTask(ctx, { subject: "build", description: "do it", status: "pending" })

    // then
    expect(task.status).toBe("pending")
    expect(task.id).toBe("1")
    const readBack = await getTeamTask(ctx, task.id)
    expect(readBack.subject).toBe("build")
  })

  test("#given two tasks with a dependency #when the blocked task is claimed before its blocker completes #then it is rejected until the blocker is completed", async () => {
    // given
    const ctx = tempContext()
    const blocker = await createTeamTask(ctx, { subject: "a", description: "blocker", status: "pending" })
    const blocked = await createTeamTask(ctx, {
      subject: "b",
      description: "dependent",
      status: "pending",
      blockedBy: [blocker.id],
    })

    // when
    expect(await canClaimTeamTask(ctx, blocked.id)).toBe(false)
    let rejected: unknown
    try {
      await claimTeamTask(ctx, blocked.id, "alpha")
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(TeamTaskBlockedByError)
    expect((rejected as TeamTaskBlockedByError).blockers).toEqual([blocker.id])

    // when the blocker is driven to completion
    await updateTeamTaskStatus(ctx, blocker.id, "in_progress", "alpha")
    await updateTeamTaskStatus(ctx, blocker.id, "completed", "alpha")

    // then the dependent task is now claimable
    expect(await canClaimTeamTask(ctx, blocked.id)).toBe(true)
    const claimed = await claimTeamTask(ctx, blocked.id, "alpha")
    expect(claimed.status).toBe("claimed")
    expect(claimed.owner).toBe("alpha")
  })

  test("#given a claimed task #when a non-owner updates its status #then a typed cross-owner error is raised", async () => {
    // given
    const ctx = tempContext()
    const task = await createTeamTask(ctx, { subject: "a", description: "x", status: "pending" })
    await claimTeamTask(ctx, task.id, "alpha")

    // when
    let rejected: unknown
    try {
      await updateTeamTaskStatus(ctx, task.id, "in_progress", "bravo")
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(TeamTaskCrossOwnerUpdateError)
  })

  test("#given a completed task #when a reverse transition is requested #then a typed invalid-transition error is raised", async () => {
    // given
    const ctx = tempContext()
    const task = await createTeamTask(ctx, { subject: "a", description: "x", status: "pending" })
    await updateTeamTaskStatus(ctx, task.id, "in_progress", "alpha")
    await updateTeamTaskStatus(ctx, task.id, "completed", "alpha")

    // when
    let rejected: unknown
    try {
      await updateTeamTaskStatus(ctx, task.id, "in_progress", "alpha")
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(TeamTaskInvalidTransitionError)
  })

  test("#given an already-claimed task #when a second member claims it #then a typed already-claimed error is raised", async () => {
    // given
    const ctx = tempContext()
    const task = await createTeamTask(ctx, { subject: "a", description: "x", status: "pending" })
    await claimTeamTask(ctx, task.id, "alpha")

    // when
    let rejected: unknown
    try {
      await claimTeamTask(ctx, task.id, "bravo")
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(TeamTaskAlreadyClaimedError)
  })

  test("#given several tasks #when listTeamTasks runs with an owner filter #then only that owner's tasks are returned in id order", async () => {
    // given
    const ctx = tempContext()
    const first = await createTeamTask(ctx, { subject: "a", description: "x", status: "pending" })
    await createTeamTask(ctx, { subject: "b", description: "y", status: "pending" })
    await claimTeamTask(ctx, first.id, "alpha")

    // when
    const all = await listTeamTasks(ctx)
    const owned = await listTeamTasks(ctx, { owner: "alpha" })

    // then
    expect(all.map((task) => task.id)).toEqual(["1", "2"])
    expect(owned.map((task) => task.id)).toEqual(["1"])
  })
})

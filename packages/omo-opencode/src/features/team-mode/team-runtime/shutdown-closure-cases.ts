/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { access, rm } from "node:fs/promises"

import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import { createTask } from "../team-tasklist/store"
import { createTaskInput } from "../team-tasklist/test-support"
import { loadRuntimeState } from "../team-state-store/store"
import { deleteTeam } from "./shutdown"
import { createFixture, updateMemberStatuses } from "./shutdown-test-fixtures"

describe("team-runtime closure delete policy", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("#given all tasks are terminal and required outputs are satisfied #when deleteTeam runs #then team resources are deleted", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "completed",
    })
    await createTask(fixture.teamRunId, createTaskInput({
      subject: "publish closure evidence",
      status: "completed",
      owner: "member-a",
      claimedAt: Date.now(),
      metadata: { requiredOutput: { status: "satisfied" } },
    }), fixture.config)

    // when
    const result = await deleteTeam(fixture.teamRunId, fixture.config)

    // then
    expect(result.removedLayout).toBe(false)
    const runtimeStateDirectory = getRuntimeStateDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await access(runtimeStateDirectory).then(
      () => { throw new Error(`expected ${runtimeStateDirectory} to be removed`) },
      () => undefined,
    )
  })

  test("#given a task has an unverifiable required output #when deleteTeam runs #then delete is blocked", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "completed",
    })
    const blockedTask = await createTask(fixture.teamRunId, createTaskInput({
      subject: "write closure evidence",
      status: "completed",
      owner: "member-a",
      claimedAt: Date.now(),
      metadata: {
        requiredOutput: {
          status: "missing",
          reason: "closure evidence file missing",
        },
      },
    }), fixture.config)

    // when
    const result = deleteTeam(fixture.teamRunId, fixture.config)

    // then
    await result.then(
      () => { throw new Error("expected deleteTeam to reject") },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error
        expect(error.message).toBe(`required output not verifiable for task ${blockedTask.id}: closure evidence file missing`)
      },
    )
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    expect(runtimeState.status).toBe("active")
  })

  test("#given a task has an unverifiable required output #when force deleting #then delete is still blocked", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "running",
      "member-b": "running",
    })
    const blockedTask = await createTask(fixture.teamRunId, createTaskInput({
      subject: "write closure evidence",
      status: "completed",
      owner: "member-a",
      claimedAt: Date.now(),
      metadata: {
        requiredOutput: {
          status: "failed",
          reason: "artifact checksum mismatch",
        },
      },
    }), fixture.config)

    // when
    const result = deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

    // then
    await result.then(
      () => { throw new Error("expected force deleteTeam to reject") },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error
        expect(error.message).toBe(`required output not verifiable for task ${blockedTask.id}: artifact checksum mismatch`)
      },
    )
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    expect(runtimeState.status).toBe("active")
  })

  test("#given a task is still active #when deleteTeam runs #then delete is blocked before cleanup", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "completed",
    })
    const activeTask = await createTask(fixture.teamRunId, createTaskInput({
      subject: "finish implementation",
      status: "in_progress",
      owner: "member-a",
      claimedAt: Date.now(),
    }), fixture.config)

    // when
    const result = deleteTeam(fixture.teamRunId, fixture.config)

    // then
    await result.then(
      () => { throw new Error("expected deleteTeam to reject") },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error
        expect(error.message).toBe(`task ${activeTask.id} is in_progress`)
      },
    )
    const runtimeState = await loadRuntimeState(fixture.teamRunId, fixture.config)
    expect(runtimeState.status).toBe("active")
  })
})

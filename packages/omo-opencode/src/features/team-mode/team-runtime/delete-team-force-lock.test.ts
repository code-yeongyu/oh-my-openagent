/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { access, rm } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import { withLock } from "../team-state-store/locks"
import * as runtimeStateStore from "../team-state-store/store"
import type { RuntimeState } from "../types"
import { deleteTeam } from "./delete-team"
import { createFixture } from "./shutdown-test-fixtures"

function createSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolveSignal: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve
  })

  if (resolveSignal === undefined) {
    throw new Error("signal resolver was not initialized")
  }

  return { promise, resolve: resolveSignal }
}

function getStateLockPath(teamRunId: string, config: TeamModeConfig): string {
  return path.join(getRuntimeStateDir(resolveBaseDir(config), teamRunId), "state.lock")
}

function readLockOwner(lockPath: string): string[] | undefined {
  if (!existsSync(lockPath)) return undefined
  return readFileSync(lockPath, "utf8").split("\n").slice(0, 2)
}

async function expectRuntimeDirectoryRemoved(teamRunId: string, config: TeamModeConfig): Promise<void> {
  const runtimeStateDirectory = getRuntimeStateDir(resolveBaseDir(config), teamRunId)
  await access(runtimeStateDirectory).then(
    () => { throw new Error(`expected ${runtimeStateDirectory} to be removed`) },
    () => undefined,
  )
}

describe("deleteTeam force path takes state.lock", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
    mock.restore()
  })

  test.each(["creating", "orphaned"] satisfies RuntimeState["status"][])(
    "force deletes a '%s' team through a forced locked transition instead of an unlocked save",
    async (status: RuntimeState["status"]) => {
      // given
      const fixture = await createFixture({ status })
      temporaryDirectories.push(fixture.baseDir)
      const lockPath = getStateLockPath(fixture.teamRunId, fixture.config)
      const transitionOptions: Array<{ readonly force?: boolean } | undefined> = []
      const originalTransitionRuntimeState = runtimeStateStore.transitionRuntimeState
      spyOn(runtimeStateStore, "transitionRuntimeState").mockImplementation(async (teamRunId, transition, config, options) => {
        transitionOptions.push(options)
        return await originalTransitionRuntimeState(teamRunId, transition, config, options)
      })
      const saves: Array<{ status: string; lockOwner: string[] | undefined }> = []
      const originalSaveRuntimeState = runtimeStateStore.saveRuntimeState
      spyOn(runtimeStateStore, "saveRuntimeState").mockImplementation(async (runtimeState, config) => {
        saves.push({ status: runtimeState.status, lockOwner: readLockOwner(lockPath) })
        return await originalSaveRuntimeState(runtimeState, config)
      })

      // when
      await deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

      // then
      const lockedByStateStore = ["team-state-store", String(process.pid)]
      expect(saves).toEqual([
        { status, lockOwner: lockedByStateStore },
        { status: "deleting", lockOwner: lockedByStateStore },
        { status: "deleted", lockOwner: lockedByStateStore },
      ])
      expect(transitionOptions).toEqual([undefined, { force: true }, { force: true }])
      await expectRuntimeDirectoryRemoved(fixture.teamRunId, fixture.config)
    },
  )

  test("force delete of a 'creating' team waits for a concurrent state.lock holder before writing deleting", async () => {
    // given
    const fixture = await createFixture({ status: "creating" })
    temporaryDirectories.push(fixture.baseDir)
    const lockPath = getStateLockPath(fixture.teamRunId, fixture.config)
    const holderAcquired = createSignal()
    const releaseHolder = createSignal()
    const deletingWriteAttempted = createSignal()
    let holder: Promise<void> | undefined
    let holderHoldsLock = false
    const originalTransitionRuntimeState = runtimeStateStore.transitionRuntimeState
    spyOn(runtimeStateStore, "transitionRuntimeState").mockImplementation(async (teamRunId, transition, config, options) => {
      if (options?.force === true) deletingWriteAttempted.resolve()
      const nextRuntimeState = await originalTransitionRuntimeState(teamRunId, transition, config, options)
      // the holder grabs state.lock right after the member-completion transition, so the deleting write has to wait for it
      if (holder === undefined) {
        holder = withLock(lockPath, async () => {
          holderHoldsLock = true
          holderAcquired.resolve()
          await releaseHolder.promise
          holderHoldsLock = false
        })
        await holderAcquired.promise
      }
      return nextRuntimeState
    })
    const saves: Array<{ status: string; whileHolderHeldLock: boolean }> = []
    const originalSaveRuntimeState = runtimeStateStore.saveRuntimeState
    spyOn(runtimeStateStore, "saveRuntimeState").mockImplementation(async (runtimeState, config) => {
      saves.push({ status: runtimeState.status, whileHolderHeldLock: holderHoldsLock })
      // an unlocked deleting write (the regression) must fail the assertions below instead of hanging the test
      if (runtimeState.status === "deleting") deletingWriteAttempted.resolve()
      return await originalSaveRuntimeState(runtimeState, config)
    })

    // when
    const deletion = deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })
    await holderAcquired.promise
    await deletingWriteAttempted.promise
    const statusWhileHolderHeldLock = (await runtimeStateStore.loadRuntimeState(fixture.teamRunId, fixture.config)).status
    releaseHolder.resolve()
    await holder
    await deletion

    // then
    expect(statusWhileHolderHeldLock).toBe("creating")
    expect(saves).toEqual([
      { status: "creating", whileHolderHeldLock: false },
      { status: "deleting", whileHolderHeldLock: false },
      { status: "deleted", whileHolderHeldLock: false },
    ])
    await expectRuntimeDirectoryRemoved(fixture.teamRunId, fixture.config)
  })

  test("force delete of a 'creating' team still lands the final deleted write when the status races to orphaned behind the deleting write", async () => {
    // given
    const fixture = await createFixture({ status: "creating" })
    temporaryDirectories.push(fixture.baseDir)
    const transitionOptions: Array<{ readonly force?: boolean } | undefined> = []
    const originalTransitionRuntimeState = runtimeStateStore.transitionRuntimeState
    spyOn(runtimeStateStore, "transitionRuntimeState").mockImplementation(async (teamRunId, transition, config, options) => {
      transitionOptions.push(options)
      const nextRuntimeState = await originalTransitionRuntimeState(teamRunId, transition, config, options)
      // the orphan handler may flip any status to orphaned, and orphaned has no FSM edge to deleted
      if (nextRuntimeState.status === "deleting") {
        await originalTransitionRuntimeState(teamRunId, (currentRuntimeState) => ({ ...currentRuntimeState, status: "orphaned" }), config)
      }
      return nextRuntimeState
    })
    const savedStatuses: string[] = []
    const originalSaveRuntimeState = runtimeStateStore.saveRuntimeState
    spyOn(runtimeStateStore, "saveRuntimeState").mockImplementation(async (runtimeState, config) => {
      savedStatuses.push(runtimeState.status)
      return await originalSaveRuntimeState(runtimeState, config)
    })

    // when
    await deleteTeam(fixture.teamRunId, fixture.config, undefined, undefined, { force: true })

    // then
    expect(savedStatuses).toEqual(["creating", "deleting", "orphaned", "deleted"])
    expect(transitionOptions).toEqual([undefined, { force: true }, { force: true }])
    await expectRuntimeDirectoryRemoved(fixture.teamRunId, fixture.config)
  })
})

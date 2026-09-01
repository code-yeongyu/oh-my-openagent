import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentityPaths } from "../identity"
import { createLockRecord, factsQueueLockPath, withLock } from "../locks"
import { factsQueuePaths } from "./schema"
import { FactsFailuresCorruptError } from "./failures-schema"
import { FactsFailureStore } from "./failures-store"

const IDENTITY = "facts-failures-agent"
const CONVERSATION = "conversation-alpha"
const T0 = new Date("2026-08-16T00:00:00.000Z")
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

async function identityFixture(): Promise<MemoryIdentityPaths> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-failures-")))
  tempDirs.push(dir)
  return buildIdentityPaths(join(dir, "memory"), IDENTITY)
}

function target(endMessageId = "m2", endSnapshotLine = 4, conversationId = CONVERSATION) {
  return { conversationId, endMessageId, endSnapshotLine }
}

describe("facts failures layout", () => {
  test("#given an identity #when the queue layout is built #then failures.json sits beside consumed.json", async () => {
    // given
    const paths = await identityFixture()

    // when
    const layout = factsQueuePaths(paths)

    // then
    expect(layout.failuresPath).toBe(join(layout.queueDir, "failures.json"))
  })
})

describe("facts failure store persistence", () => {
  test("#given no failures file #when the store reads #then empty state is returned", async () => {
    // given
    const store = new FactsFailureStore({ identityPaths: await identityFixture() })

    // when
    const state = await store.readFailures()

    // then
    expect(state.version).toBe(1)
    expect(state.entries).toEqual([])
  })

  test("#given a recorded failure #when the store persists it #then the file is 0600 with a trailing newline", async () => {
    // given
    const paths = await identityFixture()
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0 })

    // when
    await store.recordFailure({ targets: [target()], failureId: "run-a", reason: "child_exit" })

    // then
    const layout = factsQueuePaths(paths)
    const raw = await readFile(layout.failuresPath, "utf8")
    expect(raw.endsWith("\n")).toBe(true)
    const info = await stat(layout.failuresPath)
    const probePath = join(paths.factsQueue, "mode-probe")
    await writeFile(probePath, "probe", "utf8")
    await chmod(probePath, 0o600)
    const probeMode = (await stat(probePath)).mode & 0o777
    await rm(probePath, { force: true })
    // Exact mode enforcement is asserted when the filesystem represents POSIX bits; otherwise
    // compare the ledger with the platform's representable owner/group/other capabilities.
    const representableMask = (~(probeMode ^ 0o600)) & 0o777
    expect(info.mode & representableMask).toBe(0o600 & representableMask)
    expect((await readdir(layout.queueDir)).filter((name) => name.includes(".tmp"))).toEqual([])
  })

  test("#given a persisted failure #when the same failureId replays #then the streak stays at one", async () => {
    // given
    const paths = await identityFixture()
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0 })
    await store.recordFailure({ targets: [target()], failureId: "run-a", reason: "child_exit" })

    // when
    await store.recordFailure({ targets: [target()], failureId: "run-a", reason: "child_exit" })

    // then
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.streak).toBe(1)
    expect(state.entries[0]?.nextEligibleAt).toBe(new Date(T0.getTime() + 60_000).toISOString())
  })

  test("#given persisted failures #when the batch succeeds #then only its records are cleared", async () => {
    // given
    const paths = await identityFixture()
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0 })
    await store.recordFailure({
      targets: [target(), target("m9", 12, "conversation-beta")],
      failureId: "run-a",
      reason: "child_exit",
    })

    // when
    await store.clearOnSuccess([target()])

    // then
    const state = await store.readFailures()
    expect(state.entries.map((row) => row.conversationId)).toEqual(["conversation-beta"])
  })

  test("#given parked records #when a retry clears one conversation #then the rest stay parked", async () => {
    // given
    const paths = await identityFixture()
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0 })
    for (const index of [0, 1, 2, 3, 4]) {
      await store.recordFailure({
        targets: [target(), target("m9", 12, "conversation-beta")],
        failureId: `run-${index}`,
        reason: "child_exit",
      })
    }

    // when
    const cleared = await store.clearForRetry({ conversationId: CONVERSATION })

    // then
    expect(cleared).toBe(1)
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.conversationId).toBe("conversation-beta")
    expect(state.entries[0]?.state).toBe("parked")
  })

  test("#given a corrupt failures file #when the store reads #then it fails closed with a typed error", async () => {
    // given
    const paths = await identityFixture()
    const layout = factsQueuePaths(paths)
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0 })
    await store.recordFailure({ targets: [target()], failureId: "run-a", reason: "child_exit" })
    await writeFile(layout.failuresPath, "{ not json", "utf8")

    // when / then
    await expect(store.readFailures()).rejects.toBeInstanceOf(FactsFailuresCorruptError)
  })

  test("#given a corrupt failures file #when a failure is recorded #then the write fails closed and the file is untouched", async () => {
    // given
    const paths = await identityFixture()
    const layout = factsQueuePaths(paths)
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0 })
    await store.recordFailure({ targets: [target()], failureId: "run-a", reason: "child_exit" })
    await writeFile(layout.failuresPath, "{ not json", "utf8")

    // when
    const outcome = await store
      .recordFailure({ targets: [target()], failureId: "run-b", reason: "child_exit" })
      .then(() => "resolved")
      .catch((error: unknown) => error)

    // then
    expect(outcome).toBeInstanceOf(FactsFailuresCorruptError)
    expect(await readFile(layout.failuresPath, "utf8")).toBe("{ not json")
  })

  test("#given the facts-queue lock is held #when the store records a failure #then it waits for the lock instead of writing", async () => {
    // given
    const paths = await identityFixture()
    const layout = factsQueuePaths(paths)
    const store = new FactsFailureStore({ identityPaths: paths, now: () => T0, lockWaitMs: 50 })
    const record = await createLockRecord("facts-queue")
    let observedDuringLock: string[] = []

    // when
    const outcome = await withLock(
      factsQueueLockPath(paths.locks),
      record,
      async () => {
        const attempt = await store
          .recordFailure({ targets: [target()], failureId: "run-a", reason: "child_exit" })
          .then(() => "resolved")
          .catch(() => "rejected")
        observedDuringLock = await readdir(layout.queueDir).catch(() => [] as string[])
        return attempt
      },
      { waitTimeoutMs: 1000 },
    )

    // then
    expect(outcome).toBe("rejected")
    expect(observedDuringLock.includes("failures.json")).toBe(false)
  })
})

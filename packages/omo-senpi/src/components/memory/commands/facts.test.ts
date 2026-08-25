// The failure ledger under test is the REAL `FactsFailureStore` on a real temp identity dir:
// a double that answers "no failures" would let a broken retry pass silently.

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { FactsFailureStore, factsQueuePaths } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, tempIdentity, type FakeDeps } from "./commands.test-support"
import { registerFactsCommand } from "./facts"
import type { MemoryCommandIdentity } from "./types"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

const NOW = new Date("2026-08-16T12:00:00.000Z")

async function seededIdentity(): Promise<MemoryCommandIdentity> {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  return identity
}

/** Two conversations with real durable failure records: A parked, B in backoff. */
async function seedFailures(identity: MemoryCommandIdentity): Promise<FactsFailureStore> {
  const store = new FactsFailureStore({ identityPaths: identity.identityPaths, now: () => NOW })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await store.recordFailure({
      targets: [{ conversationId: "conv-a", endMessageId: "msg-a", endSnapshotLine: 4 }],
      failureId: `run-a-${attempt}`,
      reason: "child_exit",
      detail: "child exited with code 1",
    })
  }
  await store.recordFailure({
    targets: [{ conversationId: "conv-b", endMessageId: "msg-b", endSnapshotLine: 7 }],
    failureId: "run-b-0",
    reason: "deadline_exceeded",
  })
  return store
}

/** A real queue file plus both watermark files, so retry can be proven not to touch them. */
async function seedQueueArtifacts(identity: MemoryCommandIdentity): Promise<string[]> {
  const layout = factsQueuePaths(identity.identityPaths)
  await mkdir(layout.cursorDir, { recursive: true })
  const entryPath = join(layout.queueDir, "20260816T115900000Z-aaaaaaaaaaaa-bbbbbbbb.json")
  await writeFile(entryPath, `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`, "utf8")
  await writeFile(layout.consumedPath, `${JSON.stringify({ version: 1, consumed: {} }, null, 2)}\n`, "utf8")
  const cursorPath = layout.cursorPath("conv-a")
  await writeFile(cursorPath, `${JSON.stringify({ version: 1, enqueued_through_snapshot_line: 4 }, null, 2)}\n`, "utf8")
  return [entryPath, layout.consumedPath, cursorPath]
}

async function snapshot(paths: readonly string[]): Promise<string[]> {
  return Promise.all(paths.map((path) => readFile(path, "utf8")))
}

interface FactsFakeDeps extends FakeDeps {
  readonly retryTriggers: string[]
}

function factsDeps(identity: MemoryCommandIdentity | undefined): FactsFakeDeps {
  const retryTriggers: string[] = []
  const deps = fakeDeps(identity, {
    now: () => NOW.getTime(),
    factsSink: {
      reconcile: async () => {
        retryTriggers.push("reconcile")
      },
    },
  })
  return Object.assign(deps, { retryTriggers })
}

async function invokeFacts(deps: FactsFakeDeps, args: string): Promise<string> {
  const pi = new MemoryFakeExtensionAPI()
  registerFactsCommand(pi, deps)
  return invoke(pi, "facts", args, fakeCommandContext())
}

describe("/facts", () => {
  test("#given parked and backoff records #when invoked #then the status view reports both plus queue depth", async () => {
    // given
    const identity = await seededIdentity()
    await seedFailures(identity)
    await seedQueueArtifacts(identity)

    // when
    const text = await invokeFacts(factsDeps(identity), "")

    // then
    expect(text).toContain("parked: 1")
    expect(text).toContain("backoff: 1")
    expect(text).toContain("conv-a")
    expect(text).toContain("child exited with code 1")
    expect(text).toContain("/facts retry")
  })

  test("#given a corrupt failures.json #when invoked #then the status view says corrupt rather than zeros", async () => {
    // given
    const identity = await seededIdentity()
    const layout = factsQueuePaths(identity.identityPaths)
    await mkdir(layout.queueDir, { recursive: true })
    await writeFile(layout.failuresPath, "{ not json", "utf8")

    // when
    const text = await invokeFacts(factsDeps(identity), "")

    // then
    expect(text).toContain("UNREADABLE")
    expect(text).not.toContain("parked: 0")
    expect(text).not.toContain("backoff: 0")
  })

  test("#given records for two conversations #when retrying one #then only its records are cleared", async () => {
    // given
    const identity = await seededIdentity()
    const store = await seedFailures(identity)

    // when
    const text = await invokeFacts(factsDeps(identity), "retry --conversation conv-a")

    // then
    const remaining = await store.readFailures()
    expect(remaining.entries.map((record) => record.conversationId)).toEqual(["conv-b"])
    expect(text).toContain("conv-a")
    expect(text).toContain("1 record")
  })

  test("#given queue files and watermarks #when retrying #then every queue artifact is byte-identical", async () => {
    // given
    const identity = await seededIdentity()
    await seedFailures(identity)
    const paths = await seedQueueArtifacts(identity)
    const before = await snapshot(paths)
    const namesBefore = (await readdir(factsQueuePaths(identity.identityPaths).queueDir)).sort()

    // when
    await invokeFacts(factsDeps(identity), "retry")

    // then
    expect(await snapshot(paths)).toEqual(before)
    expect((await readdir(factsQueuePaths(identity.identityPaths).queueDir)).sort()).toEqual(namesBefore)
  })

  test("#given parked records #when retrying without a filter #then all conversations are named and one launch is triggered", async () => {
    // given
    const identity = await seededIdentity()
    const store = await seedFailures(identity)
    const deps = factsDeps(identity)

    // when
    const text = await invokeFacts(deps, "retry")

    // then
    expect((await store.readFailures()).entries).toEqual([])
    expect(text).toContain("conv-a")
    expect(text).toContain("conv-b")
    expect(deps.retryTriggers).toEqual(["reconcile"])
  })

  test("#given no records for the requested conversation #when retrying #then it is a no-op with a clear message", async () => {
    // given
    const identity = await seededIdentity()
    const store = await seedFailures(identity)
    const deps = factsDeps(identity)

    // when
    const text = await invokeFacts(deps, "retry --conversation unknown-conv")

    // then
    expect((await store.readFailures()).entries).toHaveLength(2)
    expect(text).toContain("no failure records")
    expect(text).toContain("unknown-conv")
    expect(deps.retryTriggers).toEqual([])
  })

  test("#given an unbound session #when invoked #then an actionable error is returned", async () => {
    // given
    const deps = factsDeps(undefined)

    // when
    const text = await invokeFacts(deps, "")

    // then
    expect(text).toContain("not bound")
  })
})

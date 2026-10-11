import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { DURABLE_JSON_FS } from "./durable-json"
import {
  pruneMissingStoreIndexEntries,
  pruneMissingStoreIndexEntriesSync,
  readTaskStoreIndex,
  registerStoreIndex,
  StoreIndexUnavailableError,
  taskStoreIndexPath,
} from "./store-index"

const dirs: string[] = []

// The store index is the host runner's admission precondition, and the rpc-host-sharding plan keeps the host
// runner off win32 (U6: "the host runner is never used on win32"; Must NOT: "`RpcHostRunner` still unused
// there"). A throughput case - 800 new stores, each a whole-index rewrite and fsync under one lock - measures
// a path no win32 session takes, and a windows-latest runner spends over 60 s on those serialized fsyncs.
const posixHostRunnerTest = test.skipIf(process.platform === "win32")

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function indexPath(): string {
  const agentDir = mkdtempSync(join(tmpdir(), "dh-t7-index-"))
  dirs.push(agentDir)
  return taskStoreIndexPath(agentDir)
}

describe("registerStoreIndex", () => {
  test("#given a store registered twice #when read back #then it is listed once with the time it was first registered", async () => {
    // given
    const path = indexPath()
    let now = 1_000

    // when
    await registerStoreIndex({ indexPath: path, storeDir: "/p1/.omo/senpi-task", now: () => now })
    now = 2_000
    await registerStoreIndex({ indexPath: path, storeDir: "/p1/.omo/senpi-task", now: () => now })

    // then
    expect(readTaskStoreIndex(path)).toEqual({
      version: 1,
      stores: { [resolve("/p1/.omo/senpi-task")]: { first_seen: new Date(1_000).toISOString(), last_seen: new Date(1_000).toISOString() } },
    })
  })

  test("#given a store already in the index #when it is registered again #then the index file is not rewritten", async () => {
    // given - an mtime far in the past, so any rewrite (a new file renamed over it) shows
    const path = indexPath()
    await registerStoreIndex({ indexPath: path, storeDir: "/p1/.omo/senpi-task", now: Date.now })
    const past = new Date(Date.now() - 3_600_000)
    utimesSync(path, past, past)
    const before = statSync(path)

    // when
    await registerStoreIndex({ indexPath: path, storeDir: "/p1/.omo/senpi-task", now: Date.now })

    // then
    const after = statSync(path)
    expect({ ino: after.ino, mtimeMs: after.mtimeMs }).toEqual({ ino: before.ino, mtimeMs: before.mtimeMs })
  })

  test("#given a write whose read-back does not contain the store #when registering #then it is unavailable", async () => {
    // given - the write lands nowhere: every read returns the empty index
    const path = indexPath()
    const fs = { read: () => undefined, write: () => undefined }

    // when
    const failure = await registerStoreIndex({ indexPath: path, storeDir: "/tmp/x-store", now: Date.now, fs }).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(StoreIndexUnavailableError)
  })

  test("#given a corrupt index #when registering #then it is unavailable and the file is left as it was", async () => {
    // given
    const path = indexPath()
    DURABLE_JSON_FS.write(path, "{not json")

    // when
    const failure = await registerStoreIndex({ indexPath: path, storeDir: "/tmp/x-store", now: Date.now }).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(StoreIndexUnavailableError)
    expect(DURABLE_JSON_FS.read(path)).toBe("{not json")
  })

  test("#given a parent path that is a file #when registering #then it is unavailable", async () => {
    // given
    const path = indexPath()
    const agentDir = join(path, "..", "..")
    writeFileSync(join(agentDir, "rpc"), "file")

    // when
    const failure = await registerStoreIndex({ indexPath: path, storeDir: "/tmp/x-store", now: Date.now }).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(StoreIndexUnavailableError)
  })

  test("#given pruning paused after its read #when another registration starts #then the index lock preserves the new store", async () => {
    const path = indexPath()
    const existingStore = join(dirname(path), "existing-store")
    mkdirSync(existingStore, { recursive: true })
    await registerStoreIndex({ indexPath: path, storeDir: "/tmp/missing-store", now: Date.now })

    let releaseRead: (() => void) | undefined
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let reportRead: (() => void) | undefined
    const readReached = new Promise<void>((resolve) => {
      reportRead = resolve
    })
    const prune = pruneMissingStoreIndexEntries(path, {
      _test: {
        afterRead: async () => {
          reportRead?.()
          await readHeld
        },
      },
    })
    await readReached
    const register = registerStoreIndex({ indexPath: path, storeDir: existingStore, now: Date.now })
    releaseRead?.()

    const [removed] = await Promise.all([prune, register])

    expect(removed).toEqual([resolve("/tmp/missing-store")])
    expect(Object.keys(readTaskStoreIndex(path).stores)).toEqual([existingStore])
  })

  test("#given a live holder that keeps the index lock past a record lock's budget #when another store registers #then it waits for the holder and lands", async () => {
    // given - a live holder slowed the way a loaded host slows an fsynced rewrite of the index
    const path = indexPath()
    const existingStore = join(dirname(path), "existing-store")
    mkdirSync(existingStore, { recursive: true })
    await registerStoreIndex({ indexPath: path, storeDir: existingStore, now: Date.now })
    let reportHeld: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      reportHeld = resolve
    })
    const slowHolder = pruneMissingStoreIndexEntries(path, {
      _test: {
        afterLockAcquired: async () => {
          reportHeld?.()
          await Bun.sleep(1_500)
        },
      },
    })
    await held

    // when
    const registered = registerStoreIndex({ indexPath: path, storeDir: "/p2/.omo/senpi-task", now: Date.now })

    // then
    await Promise.all([slowHolder, registered])
    expect(Object.keys(readTaskStoreIndex(path).stores).sort()).toEqual([existingStore, resolve("/p2/.omo/senpi-task")].sort())
  })

  test("#given compiled launcher pruning #when one indexed store is missing #then the sync port removes only that entry", async () => {
    const path = indexPath()
    const existingStore = join(dirname(path), "existing-store")
    mkdirSync(existingStore, { recursive: true })
    await registerStoreIndex({ indexPath: path, storeDir: existingStore, now: Date.now })
    await registerStoreIndex({ indexPath: path, storeDir: "/tmp/missing-sync-store", now: Date.now })

    expect(pruneMissingStoreIndexEntriesSync(path)).toEqual([resolve("/tmp/missing-sync-store")])
    expect(Object.keys(readTaskStoreIndex(path).stores)).toEqual([existingStore])
  })

  posixHostRunnerTest("#given 32 processes each registering 25 distinct stores at once #when they all finish #then every one of the 800 stores is in the index", async () => {

    // given
    const path = indexPath()
    const writer = join(import.meta.dir, "__fixtures__", "register-stores.ts")

    // when
    const writers = Array.from({ length: 32 }, (_, writerIndex) =>
      Bun.spawn([process.execPath, writer, path, `p${writerIndex}`, "25"], { stdout: "pipe", stderr: "pipe" }),
    )
    const failed = (
      await Promise.all(
        writers.map(async (child) => ({ code: await child.exited, stderr: await new Response(child.stderr).text() })),
      )
    ).filter((exit) => exit.code !== 0)

    // then
    expect(failed).toEqual([])
    expect(Object.keys(readTaskStoreIndex(path).stores)).toHaveLength(800)
  }, 60_000)
})

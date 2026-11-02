import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { openChildSessionPresence } from "./child-session-presence"
import { BackgroundManager } from "./manager"
import { TaskRecoveryStore, type TaskOwner } from "./task-recovery-store"
import { sweepTaskRecoveryRecords, type ChildPresence } from "./task-recovery-sweep"
import { TaskWorkerOwnership } from "./task-worker-ownership"

const DAY_MS = 24 * 60 * 60 * 1000
const workers: TaskWorkerOwnership[] = []

afterEach(() => {
  for (const worker of workers.splice(0)) worker.close()
})

async function liveOwner(): Promise<TaskOwner> {
  const worker = new TaskWorkerOwnership(async () => "owned")
  workers.push(worker)
  return worker.open()
}

async function deadOwner(): Promise<TaskOwner> {
  const worker = new TaskWorkerOwnership(async () => "owned")
  const owner = await worker.open()
  worker.close()
  return owner
}

function writeRecord(store: TaskRecoveryStore, sessionId: string, owner: TaskOwner, ageMs: number): string {
  mkdirSync(store.root, { recursive: true, mode: 0o700 })
  store.write({
    version: 1, sessionId, taskId: `task-${sessionId}`, parentSessionId: "parent", agent: "explore",
    cwd: tmpdir(), generation: crypto.randomUUID(), owner, tools: {},
  })
  const path = store.path(sessionId)
  age(path, ageMs)
  return path
}

function age(path: string, ageMs: number): void {
  const at = new Date(Date.now() - ageMs)
  utimesSync(path, at, at)
}

function presence(map: Record<string, ChildPresence>): (sessionId: string) => Promise<ChildPresence> {
  return async (sessionId) => map[sessionId] ?? "unknown"
}

describe("task recovery sweep", () => {
  test("#given a child session deleted after completion #when session.deleted reaches the manager #then its owner record is removed", async () => {
    // given
    const store = new TaskRecoveryStore()
    const path = writeRecord(store, "completed-child", await liveOwner(), 0)
    const client = { session: { prompt: async () => ({}), promptAsync: async () => ({}), abort: async () => ({}) } }
    const pluginContext: Pick<PluginInput, "client" | "directory"> = { client: client as unknown as PluginInput["client"], directory: tmpdir() }
    const manager = new BackgroundManager({ pluginContext: pluginContext as PluginInput })

    try {
      // when
      manager.handleEvent({ type: "session.deleted", properties: { info: { id: "completed-child" } } })

      // then
      expect(existsSync(path)).toBe(false)
    } finally {
      await manager.shutdown()
    }
  })

  test("#given crash leftovers older than the minimum age #when the sweep runs #then they are removed", async () => {
    // given
    const store = new TaskRecoveryStore()
    const orphan = writeRecord(store, "orphan-child", await deadOwner(), 2 * DAY_MS)
    const lock = `${store.path("locked-child")}.lock`
    const temp = `${store.path("written-child")}.${crypto.randomUUID()}`
    const corrupt = store.path("corrupt-child")
    for (const file of [lock, temp, corrupt]) {
      writeFileSync(file, file === corrupt ? "{not json" : "")
      age(file, 2 * DAY_MS)
    }

    // when
    const result = await sweepTaskRecoveryRecords({
      store, minAgeMs: DAY_MS, childPresence: presence({ "orphan-child": "missing" }),
    })

    // then
    expect(result.removed.map((entry) => entry.reason).sort()).toEqual(["abandoned-lock", "abandoned-temp", "child-gone", "invalid-record"])
    for (const file of [orphan, lock, temp, corrupt]) expect(existsSync(file)).toBe(false)
  })

  test("#given live, recoverable, unknown, future-format and young records #when the sweep runs #then all of them are kept", async () => {
    // given
    const store = new TaskRecoveryStore()
    const kept = [
      writeRecord(store, "live-owner", await liveOwner(), 2 * DAY_MS),
      writeRecord(store, "existing-child", await deadOwner(), 2 * DAY_MS),
      writeRecord(store, "unknown-child", await deadOwner(), 2 * DAY_MS),
      writeRecord(store, "young-child", await deadOwner(), 60_000),
    ]
    const future = store.path("future-child")
    writeFileSync(future, JSON.stringify({ version: 2, sessionId: "future-child" }))
    age(future, 2 * DAY_MS)
    const youngLock = `${store.path("busy-child")}.lock`
    writeFileSync(youngLock, "")

    // when
    const result = await sweepTaskRecoveryRecords({
      store, minAgeMs: DAY_MS,
      childPresence: presence({ "live-owner": "missing", "existing-child": "exists", "young-child": "missing" }),
    })

    // then
    expect(result.removed).toEqual([])
    for (const file of [...kept, future, youngLock]) expect(existsSync(file)).toBe(true)
  })

  test("#given more aged entries than the budget #when the sweep runs repeatedly #then each run examines at most the budget and later runs reach the rest", async () => {
    // given
    const store = new TaskRecoveryStore()
    const sessions = ["a", "b", "c", "d", "e", "f"].map((name) => `child-${name}`)
    const missing = new Set(sessions.filter((_, index) => index % 2 === 0))
    for (const sessionId of sessions) writeRecord(store, sessionId, await deadOwner(), 2 * DAY_MS)
    const run = () => sweepTaskRecoveryRecords({
      store, minAgeMs: DAY_MS, budget: 2,
      childPresence: async (sessionId) => missing.has(sessionId) ? "missing" : "exists",
    })

    // when
    const runs = [await run(), await run(), await run()]

    // then
    expect(runs.map((result) => result.examined)).toEqual([2, 2, 2])
    expect(runs.flatMap((result) => result.removed).length).toBe(3)
    for (const sessionId of sessions) expect(existsSync(store.path(sessionId))).toBe(!missing.has(sessionId))
  })

  test("#given a sweep inside the shared interval #when another process sweeps #then it skips", async () => {
    // given
    const store = new TaskRecoveryStore()
    writeRecord(store, "orphan-child", await deadOwner(), 2 * DAY_MS)
    const input = { store, minAgeMs: DAY_MS, intervalMs: 60 * 60 * 1000, childPresence: async () => "exists" as const }
    await sweepTaskRecoveryRecords(input)

    // when
    const second = await sweepTaskRecoveryRecords(input)

    // then
    expect(second.skipped).toBe(true)
  })

  test("#given opencode's session database #when looking up children #then only an absent row counts as missing", async () => {
    // given
    const dbDir = mkdtempSync(join(tmpdir(), "omo-session-db-"))
    const dbPath = join(dbDir, "opencode.db")
    const db = new Database(dbPath)
    db.run("CREATE TABLE session (id TEXT PRIMARY KEY)")
    db.run("INSERT INTO session (id) VALUES ('kept-child')")
    db.close()

    // when
    const sessions = await openChildSessionPresence(dbPath)
    const results = [sessions?.lookup("kept-child"), sessions?.lookup("deleted-child")]
    sessions?.close()
    rmSync(dbDir, { recursive: true, force: true })
    const withoutDatabase = await openChildSessionPresence(join(tmpdir(), `absent-${crypto.randomUUID()}.db`))

    // then
    expect(results).toEqual(["exists", "missing"])
    expect(withoutDatabase).toBeUndefined()
  })
})

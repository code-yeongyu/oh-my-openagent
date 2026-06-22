/**
 * Task-0 baseline benchmark for BackgroundManager.
 *
 * Measures:
 *   B1: pollRunningTasks() calls checkAndInterruptStaleTasks() 2× per cycle
 *       (CONFIRMED bug at manager.ts:1647+1649)
 *   B2: findNearestMessageExcludingCompaction() reads each message file 2×
 *       (CONFIRMED bug at manager.ts:1837-1871 — two-pass loop)
 *
 * Run with: `bun test src/features/background-agent/manager.bench.ts`
 *
 * Uses mock.module() for B2 only. B1 uses real fs.
 * Uses `?bust=<uuid>` cache buster to re-evaluate manager.ts after mocking.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import * as realFsNs from "node:fs"
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const N_TASKS = 50
const N_CYCLES = 10
const N_FILES = 3

function makeMockClient() {
  return {
    session: {
      status: async () => ({ data: {} as Record<string, { type: string }> }),
      messages: async () => ({ data: [] }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
    },
  }
}

function makeManager(): BackgroundManager {
  return new BackgroundManager({ client: makeMockClient(), directory: tmpdir() } as unknown as PluginInput)
}

describe("BackgroundManager B1 baseline (duplicate checkAndInterruptStaleTasks)", () => {
  test(
    `${N_TASKS} tasks × ${N_CYCLES} poll cycles: 2× checkAndInterruptStaleTasks per cycle`,
    async () => {
      //#given
      const manager = makeManager()
      const tasks = (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
      for (let i = 0; i < N_TASKS; i++) {
        tasks.set(`task_${i}`, {
          id: `task_${i}`,
          sessionID: `ses_${i}`,
          parentSessionID: "ses_parent",
          parentMessageID: "msg_parent",
          description: `task ${i}`,
          prompt: "test",
          agent: "test",
          status: "running",
          startedAt: new Date(),
          progress: { toolCalls: 0, lastUpdate: new Date() },
        })
      }
      let interruptCalls = 0
      ;(manager as unknown as { checkAndInterruptStaleTasks: () => Promise<void> }).checkAndInterruptStaleTasks =
        async () => {
          interruptCalls++
        }
      ;(manager as unknown as { pruneStaleTasksAndNotifications: () => void }).pruneStaleTasksAndNotifications =
        () => {}

      const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks.bind(manager)

      //#when
      const cycleTimings: number[] = []
      for (let i = 0; i < N_CYCLES; i++) {
        const start = performance.now()
        await poll()
        cycleTimings.push(performance.now() - start)
      }

      //#then
      const totalMs = cycleTimings.reduce((a, b) => a + b, 0)
      const meanMs = totalMs / cycleTimings.length
      const sorted = [...cycleTimings].sort((a, b) => a - b)
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
      const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0

      console.log(
        `BASELINE bgmanager_b1 ` +
          `interrupt_calls=${interruptCalls} ` +
          `cycles=${N_CYCLES} ` +
          `tasks=${N_TASKS} ` +
          `interrupt_calls_per_cycle=${(interruptCalls / N_CYCLES).toFixed(2)} ` +
          `total_ms=${totalMs.toFixed(4)} ` +
          `mean_ms=${meanMs.toFixed(4)} ` +
          `p50_ms=${p50.toFixed(4)} ` +
          `p99_ms=${p99.toFixed(4)}`,
      )

      // B1 BUG: 2 calls per cycle × 10 cycles = 20
      // When fixed to 1 call per cycle, this assertion will fail (10 calls)
      expect(interruptCalls).toBe(2 * N_CYCLES)
      expect(interruptCalls / N_CYCLES).toBe(2)

      manager.shutdown()
    },
    30_000,
  )
})

// ----- B2: 2× readFileSync per file in findNearestMessageExcludingCompaction -----

const TEST_STORAGE = join(tmpdir(), `bench-mgr-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE, "message")
const SESSION_ID = "ses_bench"
const SESSION_DIR = join(TEST_MESSAGE_STORAGE, SESSION_ID)

describe("BackgroundManager B2 baseline (2× readFileSync per file)", () => {
  beforeAll(() => {
    mkdirSync(SESSION_DIR, { recursive: true })
    for (let i = 0; i < N_FILES; i++) {
      writeFileSync(
        join(SESSION_DIR, `msg_${String(i).padStart(3, "0")}.json`),
        JSON.stringify({ info: { role: "user" } }),
      )
    }
  })

  afterAll(() => {
    try {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  test(`findNearestMessageExcludingCompaction: 2× readFileSync per file (${N_FILES} files)`, async () => {
    //#given
    // Capture real fs functions at call time (before mock) so wrappers don't recurse.
    const realExistsSyncRef = realFsNs.existsSync
    const realReadFileSyncRef = realFsNs.readFileSync
    const realReaddirSyncRef = realFsNs.readdirSync

    mock.module("../../shared/opencode-storage-paths", () => ({
      OPENCODE_STORAGE: TEST_STORAGE,
      MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
      PART_STORAGE: join(TEST_STORAGE, "part"),
      SESSION_STORAGE: join(TEST_STORAGE, "session"),
    }))

    let readFileSyncCalls = 0
    let existsSyncCalls = 0
    let readdirSyncCalls = 0
    mock.module("node:fs", () => {
      const wrapped = {
        ...realFsNs,
        existsSync: (path: string) => {
          existsSyncCalls++
          return realExistsSyncRef(path)
        },
        readFileSync: (...args: unknown[]) => {
          readFileSyncCalls++
          return realReadFileSyncRef(...(args as Parameters<typeof realReadFileSyncRef>))
        },
        readdirSync: (path: string) => {
          readdirSyncCalls++
          return realReaddirSyncRef(path)
        },
      }
      return wrapped as unknown as typeof realFsNs
    })

    // Re-import manager with cache buster so it picks up the mocked modules.
    const { BackgroundManager: BenchManager } = await import(`./manager?bust=${randomUUID()}`)

    // client.session.messages throws → triggers fallback in notifyParentSession
    // which calls getMessageDir → findNearestMessageExcludingCompaction.
    const client = {
      session: {
        status: async () => ({ data: {} as Record<string, { type: string }> }),
        messages: async () => {
          throw new Error("simulated failure")
        },
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        todo: async () => ({ data: [] }),
      },
    }
    const manager = new BenchManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const task: BackgroundTask = {
      id: "task_bench",
      sessionID: "ses_bench_x",
      parentSessionID: SESSION_ID,
      parentMessageID: "msg_parent",
      description: "bench",
      prompt: "bench",
      agent: "bench",
      status: "cancelled",
      startedAt: new Date(),
      completedAt: new Date(),
    }

    //#when
    await (manager as unknown as { notifyParentSession: (t: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    const readFileSyncPerFile = readFileSyncCalls / N_FILES
    console.log(
      `BASELINE bgmanager_b2 ` +
        `readFileSync=${readFileSyncCalls} ` +
        `files=${N_FILES} ` +
        `readFileSyncPerFile=${readFileSyncPerFile} ` +
        `existsSync=${existsSyncCalls} ` +
        `readdirSync=${readdirSyncCalls}`,
    )

    // B2 BUG: 2 readFileSync per file × 3 files = 6
    // When fixed to 1 readFileSync per file, this assertion will fail (3 calls)
    expect(readFileSyncCalls).toBe(2 * N_FILES)
    expect(readFileSyncPerFile).toBe(2)

    manager.shutdown()
  })
})

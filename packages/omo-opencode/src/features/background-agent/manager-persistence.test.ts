import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { createTaskPersistenceStore, type PersistedTaskSnapshot, type TaskPersistenceStore } from "./task-persistence"
import { BackgroundManager } from "./manager"
import { clearBackgroundTaskRegistryForTesting, getRegisteredBackgroundTask } from "./task-registry"
import type { BackgroundTask, BackgroundTaskStatus } from "./types"

function cast<T>(value: unknown): T {
  return value as T
}

type ManagerInternals = {
  tasks: Map<string, BackgroundTask>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  tryFallbackRetry: (
    task: BackgroundTask,
    errorInfo: { name?: string; message?: string; statusCode?: number },
    source: string,
  ) => Promise<boolean>
  scheduleTaskRemoval: (taskId: string) => void
  removeTask: (task: BackgroundTask) => void
  checkAndInterruptStaleTasks: (statuses?: Record<string, { type: string }>) => Promise<void>
}

function internals(manager: BackgroundManager): ManagerInternals {
  return cast<ManagerInternals>(manager)
}

function tasksDirFor(directory: string): string {
  return join(directory, ".omo", "background-tasks")
}

function snapshotPathFor(directory: string, taskId: string): string {
  return join(tasksDirFor(directory), `${taskId}.json`)
}

function readSnapshot(directory: string, taskId: string): PersistedTaskSnapshot {
  return JSON.parse(readFileSync(snapshotPathFor(directory, taskId), "utf-8")) as PersistedTaskSnapshot
}

function createFakeClient(sessionId: string, options?: { promptRejection?: unknown }) {
  return {
    session: {
      get: async () => ({ data: { directory: tmpdir() } }),
      create: async () => ({ data: { id: sessionId } }),
      prompt: async () => {
        if (options?.promptRejection) throw options.promptRejection
        return { data: {} }
      },
      promptAsync: async () => {
        if (options?.promptRejection) throw options.promptRejection
        return { data: {} }
      },
      abort: async () => ({ data: {} }),
    },
  }
}

const createdManagers: BackgroundManager[] = []

function createManager(args: {
  directory: string
  client: unknown
  persistence?: boolean
  persistenceStore?: TaskPersistenceStore
}): BackgroundManager {
  const manager = new BackgroundManager({
    pluginContext: cast<PluginInput>({ client: args.client, directory: args.directory }),
    config: args.persistence === undefined ? undefined : { persistence: args.persistence },
    persistenceStore: args.persistenceStore,
    // Disabled so notifyParentSession takes the no-op branch yet still funnels
    // terminal tasks into scheduleTaskRemoval (where the snapshot is persisted).
    enableParentSessionNotifications: false,
  })
  createdManagers.push(manager)
  return manager
}

type PersistRecord = { status: BackgroundTaskStatus; sessionId: string | undefined }

// A TaskPersistenceStore double that records the status/sessionId of every
// persist call (preserving order against external markers like "abort") while
// delegating to a real disk store so on-disk assertions still hold.
function createRecordingStore(
  directory: string,
  events: string[],
  records: PersistRecord[],
): TaskPersistenceStore {
  const real = createTaskPersistenceStore({ directory })
  return {
    persist(task) {
      events.push(`persist:${task.status}`)
      records.push({ status: task.status, sessionId: task.sessionId })
      real.persist(task)
    },
    persistSnapshot(snapshot) {
      real.persistSnapshot(snapshot)
    },
    delete(taskId) {
      events.push("delete")
      real.delete(taskId)
    },
    listSnapshots() {
      return real.listSnapshots()
    },
    gcOlderThan(maxAgeMs, now) {
      real.gcOlderThan(maxAgeMs, now)
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function launchAndAwaitRunning(
  manager: BackgroundManager,
  directory: string,
): Promise<BackgroundTask> {
  const launched = await manager.launch({
    description: "persist test",
    prompt: "do work",
    agent: "general",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
  })
  await waitFor(() => existsSync(snapshotPathFor(directory, launched.id)))
  const tracked = internals(manager).tasks.get(launched.id)
  await waitFor(() => internals(manager).tasks.get(launched.id)?.status === "running")
  return tracked ?? launched
}

let directory: string

beforeEach(() => {
  clearBackgroundTaskRegistryForTesting()
  releaseAllPromptAsyncReservationsForTesting()
  directory = mkdtempSync(join(tmpdir(), "omo-bg-persist-"))
})

afterEach(() => {
  for (const manager of createdManagers.splice(0)) {
    manager.shutdown()
  }
  clearBackgroundTaskRegistryForTesting()
  releaseAllPromptAsyncReservationsForTesting()
  rmSync(directory, { recursive: true, force: true })
})

describe("BackgroundManager snapshot persistence", () => {
  describe("#given a task is launched", () => {
    test("#when it starts running #then a running snapshot file is written with sessionId", async () => {
      // given
      const manager = createManager({ directory, client: createFakeClient("ses_launch") })

      // when
      const task = await launchAndAwaitRunning(manager, directory)

      // then
      expect(existsSync(snapshotPathFor(directory, task.id))).toBe(true)
      const snapshot = readSnapshot(directory, task.id)
      expect(snapshot.status).toBe("running")
      expect(snapshot.sessionId).toBe("ses_launch")
    })
  })

  describe("#given a task is launched but its session has not yet bound (F2)", () => {
    test("#when launch returns #then a pending snapshot is persisted without a sessionId", async () => {
      // given a client whose session.create never resolves, so the task is
      // persisted while still pending and never reaches the running/bound state.
      const neverResolves = new Promise<never>(() => {})
      const client = {
        session: {
          get: async () => ({ data: { directory: tmpdir() } }),
          create: () => neverResolves,
          prompt: async () => ({ data: {} }),
          promptAsync: async () => ({ data: {} }),
          abort: async () => ({ data: {} }),
        },
      }
      const manager = createManager({ directory, client })

      // when
      const launched = await manager.launch({
        description: "queued persist test",
        prompt: "do work",
        agent: "general",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_parent",
      })
      await waitFor(() => existsSync(snapshotPathFor(directory, launched.id)))

      // then
      expect(existsSync(snapshotPathFor(directory, launched.id))).toBe(true)
      const snapshot = readSnapshot(directory, launched.id)
      expect(snapshot.status).toBe("pending")
      expect(snapshot.sessionId).toBeUndefined()
    })
  })

  describe("#given a running task with a recording persistence store (F3)", () => {
    test("#when it completes #then the terminal snapshot is persisted before the session-abort side effect", async () => {
      // given a recording store and a client whose abort records its ordering
      const events: string[] = []
      const records: PersistRecord[] = []
      const store = createRecordingStore(directory, events, records)
      const client = {
        session: {
          get: async () => ({ data: { directory: tmpdir() } }),
          create: async () => ({ data: { id: "ses_order" } }),
          prompt: async () => ({ data: {} }),
          promptAsync: async () => ({ data: {} }),
          abort: async () => {
            events.push("abort")
            return { data: {} }
          },
        },
      }
      const manager = createManager({ directory, client, persistenceStore: store })
      const task = await launchAndAwaitRunning(manager, directory)

      // when
      await internals(manager).tryCompleteTask(task, "test")

      // then the completed status must be persisted before the abort await runs
      const completedIndex = events.indexOf("persist:completed")
      const abortIndex = events.indexOf("abort")
      expect(completedIndex).toBeGreaterThanOrEqual(0)
      expect(abortIndex).toBeGreaterThanOrEqual(0)
      expect(completedIndex).toBeLessThan(abortIndex)
    })
  })

  describe("#given a running task that hits a retryable error (F4)", () => {
    test("#when a fallback retry is scheduled #then the pending snapshot is persisted before the session-abort await resolves", async () => {
      // given a recording store and a client whose abort resolves only after a delay
      const events: string[] = []
      const records: PersistRecord[] = []
      const store = createRecordingStore(directory, events, records)
      const client = {
        session: {
          get: async () => ({ data: { directory: tmpdir() } }),
          create: async () => ({ data: { id: "ses_retry" } }),
          prompt: async () => ({ data: {} }),
          promptAsync: async () => ({ data: {} }),
          abort: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            events.push("abort-resolved")
            return { data: {} }
          },
        },
      }
      const manager = createManager({ directory, client, persistenceStore: store })
      const task = await launchAndAwaitRunning(manager, directory)
      task.model = { providerID: "provider-a", modelID: "original-model" }
      task.fallbackChain = [
        { model: "fallback-model-1", providers: ["provider-b"], variant: undefined },
      ]
      task.attemptCount = 0
      const recordsBefore = records.length
      const eventsBefore = events.length

      // when
      const retried = await internals(manager).tryFallbackRetry(
        task,
        { message: "model overloaded" },
        "test",
      )

      // then a pending snapshot with no sessionId is persisted
      expect(retried).toBe(true)
      const pendingPersist = records
        .slice(recordsBefore)
        .find((record) => record.status === "pending")
      expect(pendingPersist).toBeDefined()
      expect(pendingPersist?.sessionId).toBeUndefined()

      // and that persist landed before the abort await resolved
      const tail = events.slice(eventsBefore)
      const pendingIndex = tail.indexOf("persist:pending")
      const abortIndex = tail.indexOf("abort-resolved")
      expect(pendingIndex).toBeGreaterThanOrEqual(0)
      expect(abortIndex).toBeGreaterThanOrEqual(0)
      expect(pendingIndex).toBeLessThan(abortIndex)
    })
  })

  describe("#given a stale running task with a recording persistence store (F3)", () => {
    test("#when checkAndInterruptStaleTasks cancels it #then the cancelled status is persisted", async () => {
      // given a recording store and a running task far past the staleness timeout
      const events: string[] = []
      const records: PersistRecord[] = []
      const store = createRecordingStore(directory, events, records)
      const manager = createManager({
        directory,
        client: createFakeClient("ses_stale"),
        persistenceStore: store,
      })
      const task = await launchAndAwaitRunning(manager, directory)
      task.startedAt = new Date(0)
      task.progress = undefined
      // Stub the parent-notification path so the cancellation can only be
      // persisted by the poller's onTaskInterrupted callback, not by the
      // incidental scheduleTaskRemoval persist inside notifyParentSession.
      cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(
        manager,
      ).notifyParentSession = async () => {}
      const recordsBefore = records.length

      // when the stale sweep runs with no live session status registry
      await internals(manager).checkAndInterruptStaleTasks(undefined)

      // then the cancellation was persisted via onTaskInterrupted
      const cancelledPersist = records
        .slice(recordsBefore)
        .find((record) => record.status === "cancelled")
      expect(cancelledPersist).toBeDefined()
      expect(task.status).toBe("cancelled")
    })
  })

  describe("#given a running task", () => {
    test("#when it completes #then the snapshot status is completed", async () => {
      // given
      const manager = createManager({ directory, client: createFakeClient("ses_complete") })
      const task = await launchAndAwaitRunning(manager, directory)

      // when
      await internals(manager).tryCompleteTask(task, "test")

      // then
      const snapshot = readSnapshot(directory, task.id)
      expect(snapshot.status).toBe("completed")
    })

    test("#when it is cancelled via cancelTask #then the snapshot status is cancelled", async () => {
      // given
      const manager = createManager({ directory, client: createFakeClient("ses_cancel") })
      const task = await launchAndAwaitRunning(manager, directory)

      // when
      const cancelled = await manager.cancelTask(task.id)

      // then
      expect(cancelled).toBe(true)
      const snapshot = readSnapshot(directory, task.id)
      expect(snapshot.status).toBe("cancelled")
    })
  })

  describe("#given a completed task", () => {
    test("#when it is resumed #then the snapshot status returns to running", async () => {
      // given
      const manager = createManager({ directory, client: createFakeClient("ses_resume") })
      const completed: BackgroundTask = {
        id: "bg_resume",
        sessionId: "ses_resume",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_parent",
        description: "resume test",
        prompt: "say hi",
        agent: "general",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        concurrencyGroup: "general",
      }
      internals(manager).tasks.set(completed.id, completed)

      // when
      await manager.resume({
        sessionId: "ses_resume",
        prompt: "continue",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_parent_2",
      })

      // then
      const snapshot = readSnapshot(directory, completed.id)
      expect(snapshot.status).toBe("running")
    })
  })

  describe("#given a terminal task funneled through scheduleTaskRemoval", () => {
    // The error and interrupt terminal states require heavy async scaffolding to
    // reach through real lifecycle entry points, so the terminal funnel
    // (scheduleTaskRemoval) is asserted directly: every terminal status that
    // passes through it must be persisted.
    const terminalStatuses: BackgroundTaskStatus[] = [
      "completed",
      "error",
      "cancelled",
      "interrupt",
    ]
    for (const status of terminalStatuses) {
      test(`#when status is ${status} #then the snapshot reflects ${status}`, () => {
        // given
        const manager = createManager({ directory, client: createFakeClient("ses_term") })
        const task: BackgroundTask = {
          id: `bg_term_${status}`,
          sessionId: `ses_term_${status}`,
          parentSessionId: "ses_parent",
          parentMessageId: "msg_parent",
          description: "terminal test",
          prompt: "do work",
          agent: "general",
          status,
          startedAt: new Date(),
          completedAt: new Date(),
        }
        internals(manager).tasks.set(task.id, task)

        // when
        internals(manager).scheduleTaskRemoval(task.id)

        // then
        const snapshot = readSnapshot(directory, task.id)
        expect(snapshot.status).toBe(status)
      })
    }
  })

  describe("#given a persisted snapshot", () => {
    test("#when the task is removed #then the snapshot file is deleted", async () => {
      // given
      const manager = createManager({ directory, client: createFakeClient("ses_remove") })
      const task = await launchAndAwaitRunning(manager, directory)
      expect(existsSync(snapshotPathFor(directory, task.id))).toBe(true)

      // when
      internals(manager).removeTask(task)

      // then
      expect(existsSync(snapshotPathFor(directory, task.id))).toBe(false)
    })
  })

  describe("#given persistence is disabled via config", () => {
    test("#when a task is launched and completed #then no snapshot directory is created", async () => {
      // given
      const manager = createManager({
        directory,
        client: createFakeClient("ses_disabled"),
        persistence: false,
      })

      // when
      const launched = await manager.launch({
        description: "disabled test",
        prompt: "do work",
        agent: "general",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_parent",
      })
      await waitFor(() => internals(manager).tasks.get(launched.id)?.status === "running")
      const task = internals(manager).tasks.get(launched.id)
      if (task) {
        await internals(manager).tryCompleteTask(task, "test")
      }

      // then
      expect(existsSync(tasksDirFor(directory))).toBe(false)
    })
  })
})

function deadOwner(): PersistedTaskSnapshot["owner"] {
  // 999999999 is beyond Linux pid_max, so process.kill(pid, 0) reports ESRCH.
  return { pid: 999999999, startedAt: new Date().toISOString() }
}

function makeSnapshot(
  overrides: Partial<PersistedTaskSnapshot> & { id: string },
): PersistedTaskSnapshot {
  return {
    schema_version: 1,
    description: "restore test",
    agent: "general",
    status: "completed",
    owner: deadOwner(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function writeSnapshotToDisk(dir: string, snapshot: PersistedTaskSnapshot): void {
  mkdirSync(tasksDirFor(dir), { recursive: true })
  writeFileSync(
    snapshotPathFor(dir, snapshot.id),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf-8",
  )
}

function createReconcileClient(options: {
  sessionSurvives: boolean
}) {
  return {
    session: {
      get: async () =>
        options.sessionSurvives
          ? { data: { id: "ses_orphan" } }
          : { error: { name: "NotFoundError", data: {} } },
      messages: async () => ({ data: [] }),
      create: async () => ({ data: { id: "ses_orphan" } }),
      prompt: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
      abort: async () => ({ data: {} }),
    },
  }
}

describe("BackgroundManager.restorePersistedTasks", () => {
  describe("#given a terminal snapshot owned by a dead process (S1)", () => {
    test("#when manager B restores #then getTask and the registry resolve the completed task", async () => {
      // given
      const managerA = createManager({ directory, client: createFakeClient("ses_s1") })
      const task = await launchAndAwaitRunning(managerA, directory)
      await internals(managerA).tryCompleteTask(task, "test")
      expect(readSnapshot(directory, task.id).status).toBe("completed")

      // simulate a restart: the snapshot is now owned by a dead process and the
      // in-memory registry is wiped.
      const snapshot = readSnapshot(directory, task.id)
      writeSnapshotToDisk(directory, { ...snapshot, owner: deadOwner() })
      clearBackgroundTaskRegistryForTesting()

      // when
      const managerB = createManager({ directory, client: createFakeClient("ses_s1") })
      await managerB.restorePersistedTasks({ isPidAlive: () => false })

      // then
      const restored = managerB.getTask(task.id)
      expect(restored?.status).toBe("completed")
      expect(getRegisteredBackgroundTask(task.id)).toBeDefined()
    })
  })

  describe("#given a snapshot owned by a live process (S2)", () => {
    test("#when manager B restores #then nothing is restored and the file is byte-identical", async () => {
      // given
      const id = "bg_s2"
      writeSnapshotToDisk(
        directory,
        makeSnapshot({
          id,
          sessionId: "ses_s2",
          status: "completed",
          owner: { pid: process.pid, startedAt: new Date().toISOString() },
        }),
      )
      clearBackgroundTaskRegistryForTesting()
      const before = readFileSync(snapshotPathFor(directory, id), "utf-8")

      // when (real default isPidAlive sees process.pid as alive)
      const manager = createManager({ directory, client: createFakeClient("ses_s2") })
      await manager.restorePersistedTasks()

      // then
      expect(manager.getTask(id)).toBeUndefined()
      const after = readFileSync(snapshotPathFor(directory, id), "utf-8")
      expect(after).toBe(before)
    })
  })

  describe("#given an orphaned running snapshot whose session is lost (S3)", () => {
    test("#when manager B restores #then the task and snapshot become error 'session lost across restart'", async () => {
      // given
      const id = "bg_s3"
      writeSnapshotToDisk(
        directory,
        makeSnapshot({
          id,
          sessionId: "ses_orphan",
          parentSessionId: "ses_parent",
          status: "running",
        }),
      )
      clearBackgroundTaskRegistryForTesting()

      // when
      const manager = createManager({
        directory,
        client: createReconcileClient({ sessionSurvives: false }),
      })
      await manager.restorePersistedTasks({ isPidAlive: () => false })

      // then
      const restored = manager.getTask(id)
      expect(restored?.status).toBe("error")
      expect(restored?.error).toBe("session lost across restart")
      const snapshot = readSnapshot(directory, id)
      expect(snapshot.status).toBe("error")
      expect(snapshot.error).toBe("session lost across restart")
    })

    test("#when the session survived #then the task becomes interrupt with session_read guidance", async () => {
      // given
      const id = "bg_s3_interrupt"
      writeSnapshotToDisk(
        directory,
        makeSnapshot({
          id,
          sessionId: "ses_orphan",
          parentSessionId: "ses_parent",
          status: "running",
        }),
      )
      clearBackgroundTaskRegistryForTesting()

      // when
      const manager = createManager({
        directory,
        client: createReconcileClient({ sessionSurvives: true }),
      })
      await manager.restorePersistedTasks({ isPidAlive: () => false })

      // then
      const restored = manager.getTask(id)
      expect(restored?.status).toBe("interrupt")
      expect(restored?.result).toContain("session_read")
      expect(readSnapshot(directory, id).status).toBe("interrupt")
    })
  })

  describe("#given persistence is disabled", () => {
    test("#when restorePersistedTasks runs #then it resolves and no directory is created", async () => {
      // given
      const manager = createManager({
        directory,
        client: createFakeClient("ses_off"),
        persistence: false,
      })

      // when
      await manager.restorePersistedTasks()

      // then
      expect(existsSync(tasksDirFor(directory))).toBe(false)
    })
  })

  describe("#given a corrupt snapshot alongside a good one", () => {
    test("#when manager B restores #then it does not throw and the good snapshot is restored", async () => {
      // given
      mkdirSync(tasksDirFor(directory), { recursive: true })
      writeFileSync(snapshotPathFor(directory, "bg_corrupt"), "{ not valid json", "utf-8")
      writeSnapshotToDisk(
        directory,
        makeSnapshot({ id: "bg_good", sessionId: "ses_good", status: "completed" }),
      )
      clearBackgroundTaskRegistryForTesting()

      // when
      const manager = createManager({ directory, client: createFakeClient("ses_good") })
      await manager.restorePersistedTasks({ isPidAlive: () => false })

      // then
      expect(manager.getTask("bg_good")?.status).toBe("completed")
      expect(manager.getTask("bg_corrupt")).toBeUndefined()
    })
  })

  describe("#given more terminal snapshots than the archive cap", () => {
    test("#when 105 are restored #then exactly the 100-entry cap is retrievable without crashing", async () => {
      // given
      const ids: string[] = []
      for (let index = 0; index < 105; index++) {
        const id = `bg_bulk_${String(index).padStart(3, "0")}`
        ids.push(id)
        writeSnapshotToDisk(
          directory,
          makeSnapshot({ id, sessionId: `ses_${id}`, status: "completed" }),
        )
      }
      clearBackgroundTaskRegistryForTesting()

      // when
      const manager = createManager({ directory, client: createFakeClient("ses_bulk") })
      await manager.restorePersistedTasks({ isPidAlive: () => false })

      // then
      let retrievable = 0
      for (const id of ids) {
        if (manager.getTask(id)) {
          retrievable++
        }
      }
      expect(retrievable).toBe(100)
    })
  })

  describe("#given a pending no-session snapshot owned by a dead process (F2)", () => {
    test("#when manager B restores #then getTask resolves an error task 'session lost across restart'", async () => {
      // given a pending snapshot that never bound a session, owned by a dead process
      const id = "bg_f2_no_session"
      writeSnapshotToDisk(
        directory,
        makeSnapshot({
          id,
          status: "pending",
          sessionId: undefined,
          parentSessionId: "ses_parent",
        }),
      )
      clearBackgroundTaskRegistryForTesting()

      // when
      const manager = createManager({ directory, client: createFakeClient("ses_f2") })
      await manager.restorePersistedTasks({ isPidAlive: () => false })

      // then the recovered terminal error task is reachable via getTask
      const restored = manager.getTask(id)
      expect(restored?.status).toBe("error")
      expect(restored?.error).toContain("session lost across restart")
    })
  })
})

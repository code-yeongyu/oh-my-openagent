import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import type { PersistedTaskSnapshot } from "./task-persistence"
import { BackgroundManager } from "./manager"
import { clearBackgroundTaskRegistryForTesting } from "./task-registry"
import type { BackgroundTask, BackgroundTaskStatus } from "./types"

function cast<T>(value: unknown): T {
  return value as T
}

type ManagerInternals = {
  tasks: Map<string, BackgroundTask>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  scheduleTaskRemoval: (taskId: string) => void
  removeTask: (task: BackgroundTask) => void
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
}): BackgroundManager {
  const manager = new BackgroundManager({
    pluginContext: cast<PluginInput>({ client: args.client, directory: args.directory }),
    config: args.persistence === undefined ? undefined : { persistence: args.persistence },
    // Disabled so notifyParentSession takes the no-op branch yet still funnels
    // terminal tasks into scheduleTaskRemoval (where the snapshot is persisted).
    enableParentSessionNotifications: false,
  })
  createdManagers.push(manager)
  return manager
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

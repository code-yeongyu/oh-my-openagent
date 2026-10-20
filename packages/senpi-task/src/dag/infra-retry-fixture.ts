import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskManager } from "../manager/manager"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { ManagedRunner } from "../manager/types"
import { createTaskRecordStore } from "../store"
import { createDagManager } from "./manager"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import type { DagDefinition } from "./graph"

export type Outcome = Awaited<ReturnType<ManagedChildHandle["waitForOutcome"]>>

export function infraFixture(
  outcome: (name: string, attempt: number) => Outcome,
  scheduleRetry: (callback: () => void, delayMs: number) => () => void = (callback) => {
    queueMicrotask(callback)
    return () => undefined
  },
  now: () => number = Date.now,
) {
  const project = fs.mkdtempSync(join(tmpdir(), "dag-infra-retry-"))
  const starts = new Map<string, number>()
  const taskStore = createTaskRecordStore({ project_dir: project })
  const store = createDagFileStore({ project_dir: project })
  const runner: ManagedRunner = {
    start: async (spec) => {
      const attempt = (starts.get(spec.prompt) ?? 0) + 1
      starts.set(spec.prompt, attempt)
      const result = outcome(spec.prompt, attempt)
      return {
        task_id: spec.taskId,
        sessionId: `child-${spec.taskId}`,
        pid: undefined,
        steer: async () => undefined,
        followUp: async () => undefined,
        abort: async () => undefined,
        subscribe: () => () => undefined,
        waitForOutcome: async () => result,
        lastAssistantText: () => undefined,
        dispose: async () => undefined,
      }
    },
  }
  const taskManager = createTaskManager({
    store: taskStore,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "test/model" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
    cwd: project,
  })
  const manager = createDagManager({ store })
  return {
    starts,
    store,
    taskStore,
    taskManager,
    async scheduler(nodes: DagDefinition["nodes"]) {
      const started = await manager.start({
        definition: { key: "infra-retry", name: "Infrastructure retry", nodes },
        parentSessionId: "parent-infra-retry",
        rootSessionId: "parent-infra-retry",
      })
      const options = {
        store,
        taskManager,
        initialRecord: manager.record(started.snapshot.runId, "parent-infra-retry"),
        scheduleRetry,
        now,
      }
      return createDagScheduler(options)
    },
    cleanup() {
      fs.rmSync(project, { recursive: true, force: true })
    },
  }
}

export function success(): Outcome {
  return { status: "completed", finalResponse: "done" }
}

export function infrastructureFailure(): Outcome {
  return {
    status: "error",
    failure: { kind: "child-unresponsive", message: "synthetic infrastructure failure" },
  }
}

export function dagNode(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: id, category: "quick", dependsOn }
}

export class RetryClock {
  readonly delays: number[] = []
  readonly #scheduled: Array<{ readonly callback: () => void; readonly at: number; cancelled: boolean }> = []
  readonly #waiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  #time = Date.parse("2026-10-19T00:00:00.000Z")

  readonly now = (): number => this.#time
  readonly schedule = (callback: () => void, delayMs: number): (() => void) => {
    const timer = { callback, at: this.#time + delayMs, cancelled: false }
    this.delays.push(delayMs)
    this.#scheduled.push(timer)
    for (const waiter of this.#waiters) {
      if (this.delays.length >= waiter.count) waiter.resolve()
    }
    return () => { timer.cancelled = true }
  }

  whenScheduled(count: number): Promise<void> {
    if (this.delays.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#waiters.push({ count, resolve }))
  }

  advance(): void {
    const timer = this.#scheduled.shift()
    if (timer === undefined) throw new Error("no retry timer scheduled")
    this.#time = timer.at
    if (!timer.cancelled) timer.callback()
  }
}

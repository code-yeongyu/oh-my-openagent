import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import type { ManagedChildEvent, ManagedChildHandle } from "../manager/child-handle"
import { createTaskManager } from "../manager/manager"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec } from "../manager/types"
import { createTaskRecordStore } from "../store"
import { createDagManager, type DagManager, type DagRunRecordV1 } from "./manager"
import { createDagScheduler, type DagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunId } from "./types"

export const PARENT_SESSION_ID = "session-node-projection-parent"

type Outcome = { readonly status: "completed"; readonly finalResponse: string }

export type HeldChild = {
  readonly settle: (outcome: Outcome) => void
  readonly emit: (event: ManagedChildEvent) => void
}

export class HeldRunner implements ManagedRunner {
  readonly children = new Map<string, HeldChild>()
  readonly #startWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  #started = 0

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const name = spec.prompt.replace(/^do /, "")
    const pending: Outcome[] = []
    const waiters: Array<(outcome: Outcome) => void> = []
    const listeners = new Set<(event: ManagedChildEvent) => void>()
    this.children.set(name, {
      settle: (value) => {
        const waiter = waiters.shift()
        if (waiter === undefined) pending.push(value)
        else waiter(value)
      },
      emit: (event) => {
        for (const listener of listeners) listener(event)
      },
    })
    this.#started += 1
    for (const waiter of [...this.#startWaiters]) {
      if (this.#started >= waiter.count) waiter.resolve()
    }
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      waitForOutcome: () => {
        const ready = pending.shift()
        if (ready !== undefined) return Promise.resolve(ready)
        return new Promise<Outcome>((resolve) => waiters.push(resolve))
      },
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    })
  }

  whenStarted(count: number): Promise<void> {
    if (this.#started >= count) return Promise.resolve()
    return new Promise((resolve) => this.#startWaiters.push({ count, resolve }))
  }

  child(name: string): HeldChild {
    const child = this.children.get(name)
    if (child === undefined) throw new Error(`missing held child ${name}`)
    return child
  }
}

function planner(spec: Parameters<ChildPlanner>[0]): ReturnType<ChildPlanner> {
  const target = spec.category ?? spec.subagent_type ?? "default"
  return {
    kind: "resolved",
    plan: {
      model: spec.model ?? `scripted/${target}`,
      ...(spec.category === undefined ? {} : { category: spec.category }),
      ...(spec.subagent_type === undefined ? {} : { agentType: spec.subagent_type }),
    },
  }
}

export type ProjectionFixture = {
  readonly project: string
  readonly store: DagFileStore
  readonly manager: DagManager
  readonly runner: HeldRunner
  readonly runId: DagRunId
  readonly scheduler: DagScheduler
  readonly run: Promise<DagRunRecordV1>
  readonly checkpoint: () => DagRunRecordV1
  readonly whenNodeRunning: (nodeId: string) => Promise<void>
}

export const cleanupRoots: string[] = []

export async function startHeldRun(nodeIds: readonly string[]): Promise<ProjectionFixture> {
  const project = fs.mkdtempSync(join(tmpdir(), "senpi-dag-projection-"))
  cleanupRoots.push(project)
  const store = createDagFileStore({ project_dir: project })
  const runner = new HeldRunner()
  const taskManager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
    cwd: project,
  })
  const manager = createDagManager({ store, newRunId: () => "dag-projection-1" as DagRunId })
  const started = await manager.start({
    definition: {
      key: "projection",
      name: "projection",
      nodes: nodeIds.map((id) => ({ id, prompt: `do ${id}`, category: "quick", dependsOn: [] })),
    },
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: "session-node-projection-root",
  })
  const runId = started.snapshot.runId
  const scheduler = createDagScheduler({ store, taskManager, initialRecord: manager.record(runId, PARENT_SESSION_ID) })
  const run = scheduler.run()
  await runner.whenStarted(nodeIds.length)
  const whenNodeRunning = (nodeId: string): Promise<void> => {
    if (manager.record(runId, PARENT_SESSION_ID).nodes.some((node) => node.id === nodeId && node.state === "running")) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const unsubscribe = scheduler.subscribe((event) => {
        if (event.type !== "dag.node.transitioned" || event.nodeId !== nodeId || event.to !== "running") return
        unsubscribe()
        resolve()
      })
    })
  }
  return {
    project,
    store,
    manager,
    runner,
    runId,
    scheduler,
    run,
    whenNodeRunning,
    checkpoint: () => JSON.parse(fs.readFileSync(store.paths.run(runId), "utf8")) as DagRunRecordV1,
  }
}

export function assistantMessage(text: string): ManagedChildEvent {
  return { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } } as ManagedChildEvent
}

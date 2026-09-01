import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager, settings } from "../manager/__fixtures__/manager-fakes"
import type { ResolvedChildPlan } from "../manager/types"
import type { DagDefinition } from "./graph"
import { createDagManager } from "./manager"
import { createDagScheduler, type DagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import type { DagRunEvent } from "./types"

// bunfig preloads test-setup.ts to raise the default timeout, but Bun honours a preload's
// setDefaultTimeout only for the FIRST test file of a run; every later file silently reverts to
// the built-in 5000ms. Set the floor here, where Bun does honour it.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const parentSessionId = "session-spill-parent"
const rootSessionId = "session-spill-root"

const primary = {
  source: "category",
  provider: "vendor-a",
  model_id: "primary",
  display: "vendor-a/primary",
} as const
const fallback = {
  source: "category",
  provider: "vendor-b",
  model_id: "fallback",
  display: "vendor-b/fallback",
  variant: "high",
} as const

afterEach(cleanupProjects)

function spillPlan(): ResolvedChildPlan {
  return {
    model: primary.display,
    requested_model: primary,
    resolved_model: primary,
    fallback_models: [fallback],
    category: "quick",
  }
}

function definition(): DagDefinition {
  return {
    key: "wave-spill",
    name: "wave spill",
    nodes: [{ id: "worker", prompt: "do worker", category: "quick" }],
  }
}

function within<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`wave stalled after ${ms}ms`)), ms)
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function whenEvent(scheduler: DagScheduler, match: (event: DagRunEvent) => boolean): Promise<DagRunEvent> {
  return new Promise((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (!match(event)) return
      unsubscribe()
      resolve(event)
    })
  })
}

describe("DAG scheduler wave spill-through", () => {
  test("#given a node whose primary lane is full #when a fallback lane has capacity #then the wave runs on the spilled model without stalling", async () => {
    const { manager: taskManager, store, inProcess, project } = makeManager({
      planner: () => ({ kind: "resolved", plan: spillPlan() }),
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })
    const holder = await taskManager.start(baseSpec({ name: "holder" }))
    if (holder.kind !== "started") throw new Error("expected holder")

    const dagStore = createDagFileStore({ project_dir: project })
    const dagManager = createDagManager({ store: dagStore })
    const started = await dagManager.start({
      definition: definition(),
      parentSessionId,
      rootSessionId,
    })
    const runId = started.snapshot.runId
    const scheduler = createDagScheduler({
      store: dagStore,
      taskManager,
      initialRecord: dagManager.record(runId, parentSessionId),
    })
    const becameRunning = whenEvent(
      scheduler,
      (event) => event.type === "dag.node.transitioned" && event.to === "running",
    )
    const waveCompleted = whenEvent(scheduler, (event) => event.type === "dag.wave.completed")
    const runPromise = scheduler.run()

    await within(becameRunning)

    const node = scheduler.snapshot().nodes.find((entry) => String(entry.id) === "worker")
    expect(node?.state).toBe("running")
    const taskId = node?.taskId
    if (taskId === undefined) throw new Error("expected attached task")
    const record = store.load(taskId)
    expect(record).toMatchObject({
      model: fallback.display,
      requested_model: primary,
      resolved_model: fallback,
      fallback_models: [],
      status: "running",
    })
    expect(record?.fallback_attempts).toBeUndefined()
    expect(inProcess.startedSpecs.find((spec) => spec.taskId === taskId)).toMatchObject({
      model: fallback.display,
      requestedModel: primary,
      resolvedModel: fallback,
      fallbackModels: [],
    })

    const spilled = inProcess.handles.get(taskId)
    if (spilled === undefined) throw new Error("expected spilled child handle")
    spilled.settle({ status: "completed", finalResponse: "spilled" })

    const snapshot = await within(runPromise)
    await within(waveCompleted)

    expect(snapshot.status).toBe("completed")
    expect(snapshot.nodes).toEqual([
      expect.objectContaining({ id: "worker", state: "completed", taskId }),
    ])
    expect(store.load(taskId)).toMatchObject({
      model: fallback.display,
      requested_model: primary,
      resolved_model: fallback,
      status: "completed",
    })
    expect(store.load(holder.task_id)?.status).toBe("running")
  })
})

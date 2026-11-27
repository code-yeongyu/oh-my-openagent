import { afterEach, expect, test } from "bun:test"

import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedStartSpec, ResolvedChildPlan } from "./types"
import { createUsageLimitMemory } from "./usage-limit-memory"

afterEach(cleanupProjects)

const rung = (provider: string, modelId: string): ResolvedModelRecord => ({
  source: "category",
  provider,
  model_id: modelId,
  display: `${provider}/${modelId}`,
})
const primary = rung("vendor-a", "primary")
const fallback = rung("vendor-b", "fallback")
const spentToo = rung("vendor-c", "spent")
const healthy = rung("vendor-d", "healthy")
const ACCOUNT_LIMIT = "Account usage limit reached"

class WatchedRunner extends FakeRunner {
  readonly #waiting = new Map<string, () => void>()
  startedFor(taskId: string): Promise<void> {
    if (this.startedSpecs.some((spec) => spec.taskId === taskId)) return Promise.resolve()
    return new Promise((resolve) => this.#waiting.set(taskId, resolve))
  }
  override start(spec: ManagedStartSpec) {
    const started = super.start(spec)
    this.#waiting.get(spec.taskId)?.()
    return started
  }
}

function chainOf(first: ResolvedModelRecord, ...fallbacks: ResolvedModelRecord[]): ResolvedChildPlan {
  return { model: first.display, requested_model: first, resolved_model: first, fallback_models: fallbacks }
}

function fixture(spillPlan: ResolvedChildPlan = chainOf(primary, fallback), held: ResolvedModelRecord = fallback) {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const memory = createUsageLimitMemory(Date.now)
  const runner = new WatchedRunner()
  const holderPlan: ResolvedChildPlan = { model: held.display, resolved_model: held, fallback_models: [] }
  const manager = createTaskManager({
    store,
    usageLimits: memory,
    cwd: project,
    runners: { process: runner, "in-process": runner },
    planner: (spec) => ({ kind: "resolved", plan: spec.name === "holder" ? holderPlan : spillPlan }),
    // Every model is its own lane with one slot: the primary's lane and the fallback's lane are distinct.
    config: settings({ default_concurrency: 1, max_depth: 1 }),
  })
  return { manager, store, memory, runner }
}

test("#given a spent primary with a free lane and a full fallback lane #when spawning #then the task queues on the fallback and launches only when that lane frees (review 15140 #1)", async () => {
  // given
  const f = fixture()
  try {
    const holder = await f.manager.start(baseSpec({ name: "holder" }))
    if (holder.kind !== "started" || holder.status !== "running") throw new Error("expected a running holder")
    f.memory.settle("earlier", primary.provider, primary.model_id, "Account usage limit reached")

    // when
    const result = await f.manager.start(baseSpec({ name: "rerouted" }))

    // then: the fallback lane is full, so the rerouted task waits for it instead of running beside the holder.
    expect(result).toMatchObject({ kind: "started", status: "pending" })
    if (result.kind !== "started") throw new Error("expected a queued start")
    expect(f.runner.startedSpecs.map((spec) => spec.taskId)).toEqual([holder.task_id])
    expect(f.store.load(result.task_id)).toMatchObject({ model: fallback.display, resolved_model: fallback })

    // and it launches on the fallback once the holder frees that lane.
    const launched = f.runner.startedFor(result.task_id)
    const holderDone = f.manager.waitFor(holder.task_id)
    f.runner.handles.get(holder.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await holderDone
    await launched
    expect(f.runner.startedSpecs.at(-1)).toMatchObject({ taskId: result.task_id, model: fallback.display })
  } finally {
    f.manager.workpools.dispose()
  }
})

test("#given a busy unspent primary and only spent fallbacks with free lanes #when spawning #then the task queues on the primary and never starts on a spent rung (review 15140 delta HIGH)", async () => {
  // given
  const f = fixture(chainOf(primary, fallback, spentToo), primary)
  try {
    const holder = await f.manager.start(baseSpec({ name: "holder" }))
    if (holder.kind !== "started" || holder.status !== "running") throw new Error("expected a running holder")
    f.memory.settle("earlier", fallback.provider, fallback.model_id, ACCOUNT_LIMIT)
    f.memory.settle("earlier", spentToo.provider, spentToo.model_id, ACCOUNT_LIMIT)

    // when
    const result = await f.manager.start(baseSpec({ name: "spill" }))

    // then
    expect(result).toMatchObject({ kind: "started", status: "pending", resolved_model: primary })
    expect(f.runner.startedSpecs.map((spec) => spec.taskId)).toEqual([holder.task_id])
  } finally {
    f.manager.workpools.dispose()
  }
})

test("#given a busy unspent primary, a free spent fallback and a free healthy fallback #when spawning #then the task starts on the healthy fallback (review 15140 delta HIGH)", async () => {
  // given
  const f = fixture(chainOf(primary, fallback, healthy), primary)
  try {
    const holder = await f.manager.start(baseSpec({ name: "holder" }))
    if (holder.kind !== "started" || holder.status !== "running") throw new Error("expected a running holder")
    f.memory.settle("earlier", fallback.provider, fallback.model_id, ACCOUNT_LIMIT)

    // when
    const result = await f.manager.start(baseSpec({ name: "spill" }))

    // then
    expect(result).toMatchObject({ kind: "started", status: "running", resolved_model: healthy })
    expect(f.runner.startedSpecs.at(-1)).toMatchObject({ model: healthy.display })
  } finally {
    f.manager.workpools.dispose()
  }
})

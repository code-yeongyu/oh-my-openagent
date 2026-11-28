import { afterEach, expect, test } from "bun:test"

import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { baseSpec, cleanupProjects, FakeRunner, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedStartSpec } from "./types"
import { createUsageLimitMemory, LIMIT_MEMORY_DEFAULT_MS } from "./usage-limit-memory"

afterEach(cleanupProjects)

const rung = (provider: string, modelId: string): ResolvedModelRecord => ({
  source: "category",
  provider,
  model_id: modelId,
  display: `${provider}/${modelId}`,
})
const primary = rung("test", "first")
const next = rung("test", "next")
const AMBIGUOUS = "Weekly usage limit reached"

class GatedRunner extends FakeRunner {
  readonly #starts: Array<{ readonly count: number; readonly resolve: () => void }> = []
  gate: ((spec: ManagedStartSpec) => Promise<ManagedChildHandle>) | undefined
  started(count: number): Promise<void> {
    if (this.startedSpecs.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#starts.push({ count, resolve }))
  }
  override start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const gate = this.gate
    const started = gate === undefined ? super.start(spec) : (this.startedSpecs.push(spec), gate(spec))
    for (const waiter of this.#starts.filter((entry) => entry.count <= this.startedSpecs.length)) waiter.resolve()
    return started
  }
}

function fixture(now: () => number = Date.now) {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const memory = createUsageLimitMemory(now)
  const runner = new GatedRunner()
  const manager = createTaskManager({
    store,
    usageLimits: memory,
    cwd: project,
    runners: { process: runner, "in-process": runner },
    planner: () => ({
      kind: "resolved",
      plan: { model: primary.display, resolved_model: primary, fallback_models: [next] },
    }),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
  })
  return { manager, store, memory, runner }
}

test("#given a probe run interrupted before answering #when its revival fails for an ordinary reason #then the provider is not remembered spent (review 15140 #2)", async () => {
  // given
  const f = fixture()
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    const probeStarted = f.runner.started(2)
    f.runner.handles.get(result.task_id)?.settle({
      status: "error",
      failure: { kind: "child-turn-failed", message: AMBIGUOUS },
    })
    await probeStarted
    const probe = f.runner.handles.get(result.task_id)
    if (probe === undefined) throw new Error("expected the probe rung")
    await probe.waitForSubscription()
    const interrupted = f.manager.waitFor(result.task_id)
    probe.settle({ status: "interrupted" })
    await interrupted
    expect(f.store.load(result.task_id)?.status).toBe("interrupted")

    // when
    expect(await f.manager.sendToTask({ idOrName: result.task_id, message: "continue" })).toMatchObject({
      kind: "revived",
    })
    const failed = f.manager.waitFor(result.task_id)
    probe.settle({ status: "error", failure: { kind: "child-turn-failed", message: "socket hang up" } })
    await failed

    // then
    expect(f.memory.accountSpent(next.provider)).toBe(false)
  } finally {
    f.manager.workpools.dispose()
  }
})

test("#given a probe start that resolves after its run moved on #when the stale child is discarded #then no probe entry outlives it (review 15140 #2)", async () => {
  // given
  const f = fixture()
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    let finishStart: (handle: ManagedChildHandle) => void = () => {}
    f.runner.gate = () => new Promise((resolve) => (finishStart = resolve))
    const probeStarted = f.runner.started(2)
    f.runner.handles.get(result.task_id)?.settle({
      status: "error",
      failure: { kind: "child-turn-failed", message: AMBIGUOUS },
    })
    await probeStarted
    expect(f.memory.probeOf(result.task_id)).toBeDefined()

    // when: another owner moved the task to a newer run while the probe child was starting.
    const record = f.store.load(result.task_id)
    if (record === null) throw new Error("expected the record")
    f.store.replace({
      ...record,
      notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
    })
    let disposed: () => void = () => {}
    const discarded = new Promise<void>((resolve) => (disposed = resolve))
    const late = makeHandle(result.task_id)
    finishStart({ ...late.handle, dispose: async () => disposed() })
    await discarded

    // then
    expect(f.memory.probeOf(result.task_id)).toBeUndefined()
  } finally {
    f.manager.workpools.dispose()
  }
})

async function probeStartPending(f: ReturnType<typeof fixture>) {
  const result = await f.manager.start(baseSpec())
  if (result.kind !== "started") throw new Error("expected start")
  let failStart: (error: Error) => void = () => {}
  f.runner.gate = () => new Promise((_resolve, reject) => (failStart = reject))
  const probeStarted = f.runner.started(2)
  f.runner.handles.get(result.task_id)?.settle({
    status: "error",
    failure: { kind: "child-turn-failed", message: AMBIGUOUS },
  })
  await probeStarted
  const record = f.store.load(result.task_id)
  if (record === null) throw new Error("expected the record")
  return { taskId: result.task_id, record, failStart }
}

test("#given a probe start that rejects after its run was cancelled #when the rejection settles #then no provider-wide limit is written and that run's probe is cleared (review 15140 delta MEDIUM)", async () => {
  // given
  const f = fixture()
  try {
    const { taskId, record, failStart } = await probeStartPending(f)
    const epoch = record.notification.run_epoch
    expect(f.memory.probeOf(taskId, epoch)).toBeDefined()
    const settled = f.manager.waitFor(taskId)
    f.store.replace({ ...record, status: "cancelled" })

    // when: the cancel's teardown makes the pending start fail.
    failStart(new Error("child torn down before it started"))
    await settled

    // then
    expect(f.memory.accountSpent(next.provider)).toBe(false)
    expect(f.memory.probeOf(taskId, epoch)).toBeUndefined()
  } finally {
    f.manager.workpools.dispose()
  }
})

test("#given a probe start that rejects after a newer run began its own probe #when the rejection settles #then the newer run's probe is untouched (review 15140 delta MEDIUM)", async () => {
  // given
  const f = fixture()
  try {
    const { taskId, record, failStart } = await probeStartPending(f)
    const newer = record.notification.run_epoch + 1
    const settled = f.manager.waitFor(taskId)
    f.store.replace({ ...record, status: "cancelled", notification: { ...record.notification, run_epoch: newer } })
    f.memory.beginProbe(taskId, next.provider, AMBIGUOUS, newer)

    // when
    failStart(new Error("child torn down before it started"))
    await settled

    // then
    expect(f.memory.probeOf(taskId, newer)).toBeDefined()
    expect(f.memory.accountSpent(next.provider)).toBe(false)
  } finally {
    f.manager.workpools.dispose()
  }
})

test("#given a probe begun an hour ago #when its task settles an ordinary failure #then the stale probe no longer decides the provider's scope (review 15140 #2)", () => {
  // given
  let now = Date.parse("2026-10-26T05:00:00Z")
  const memory = createUsageLimitMemory(() => now)
  memory.beginProbe("task", "anthropic", `${AMBIGUOUS}. Resets at 2099-10-26T06:00:00Z`)

  // when
  now += LIMIT_MEMORY_DEFAULT_MS

  // then
  expect(memory.probeOf("task")).toBeUndefined()
  memory.settle("task", "anthropic", "opus", "socket hang up")
  expect(memory.accountSpent("anthropic")).toBe(false)
})

import { afterEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import { createTaskManager } from "./manager"
import { createUsageLimitMemory } from "./usage-limit-memory"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import type { ManagedStartSpec } from "./types"
import { resolveChildSessionDir } from "../runners/rpc/spawn"

afterEach(cleanupProjects)
const rung = (id: string): ResolvedModelRecord => {
  const [provider = "", modelId = ""] = id.split("/")
  return { provider, model_id: modelId, display: id, source: "category" }
}
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected fixture value")
  return value
}
const primary = rung("test/first")
const next = rung("test/next")
const other = rung("other/next")

function fixture(fallbacks: readonly ResolvedModelRecord[] = [], now: () => number = Date.now) {
  const project = tempProject()
  const memory = createUsageLimitMemory(now)
  const backing = createTaskRecordStore({ project_dir: project })
  let intercept: ((record: TaskRecord) => TaskRecord) | undefined
  const store: TaskRecordStore = {
    ...backing,
    mutate: (id, change) => backing.mutate(id, (record) => change(intercept?.(record) ?? record)),
  }
  const runner = Object.assign(new FakeRunner(), {
    resume: (spec: ManagedStartSpec, _path: string) => runner.start(spec),
  })
  const manager = createTaskManager({
    store, usageLimits: memory, cwd: project,
    runners: { process: runner, "in-process": runner },
    planner: () => ({ kind: "resolved", plan: { model: primary.display, resolved_model: primary, fallback_models: fallbacks } }),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
  })
  return { manager, memory, runner, backing, intercept: (hook: typeof intercept) => { intercept = hook } }
}

test("a remembered-limit spawn refusal is machine readable and persisted", async () => {
  const f = fixture()
  try {
    f.memory.settle("earlier", primary.provider, primary.model_id, "Account usage limit reached")
    const result = await f.manager.start(baseSpec())
    expect(result).toMatchObject({ kind: "start_failed", failure_kind: "usage_limit" })
    if (result.kind !== "start_failed") throw new Error("expected refusal")
    expect(f.manager.get(result.task_id)?.failure_kind).toBe("usage_limit")
    expect(f.runner.startedSpecs).toHaveLength(0)
  } finally { f.manager.workpools.dispose() }
})

test("a resumed task routes around remembered provider limits before launching", async () => {
  const f = fixture([other])
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    const record = present(f.manager.get(result.task_id))
    f.manager.forget(result.task_id, { path: "end" })
    f.memory.settle("earlier", primary.provider, primary.model_id, "Account usage limit reached")
    const resumed = await f.manager.respawn(record)
    expect(resumed.ok).toBe(true)
    expect(f.runner.startedSpecs.at(-1)?.model).toBe(other.display)
    expect(f.manager.get(result.task_id)?.resolved_model).toEqual(other)
  } finally { f.manager.workpools.dispose() }
})

test("a warm revival refuses a remembered spent chain before delivering a prompt", async () => {
  const f = fixture()
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    const fake = present(f.runner.handles.get(result.task_id))
    const done = f.manager.waitFor(result.task_id)
    fake.settle({ status: "completed", finalResponse: "done" })
    await done
    f.memory.settle("earlier", primary.provider, primary.model_id, "Account usage limit reached")
    expect(await f.manager.sendToTask({ idOrName: result.task_id, message: "continue" }))
      .toMatchObject({ kind: "not_continuable", failure_kind: "usage_limit" })
    expect(fake.followUpCalls).toHaveLength(0)
  } finally { f.manager.workpools.dispose() }
})

test("a warm revival resumes its transcript on an unspent alternative", async () => {
  const f = fixture([other])
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    const fake = present(f.runner.handles.get(result.task_id))
    const done = f.manager.waitFor(result.task_id)
    fake.settle({ status: "completed", finalResponse: "done" })
    await done
    const sessions = resolveChildSessionDir(join(f.backing.stateDir, "children", result.task_id), result.task_id)
    mkdirSync(sessions, { recursive: true })
    writeFileSync(join(sessions, "completed.jsonl"), "")
    f.memory.settle("earlier", primary.provider, primary.model_id, "Account usage limit reached")
    expect(await f.manager.sendToTask({ idOrName: result.task_id, message: "continue" })).toMatchObject({ kind: "revived" })
    expect(f.runner.startedSpecs.at(-1)?.model).toBe(other.display)
    expect(fake.followUpCalls).toHaveLength(0)
    expect(f.runner.handles.get(result.task_id)?.followUpCalls).toEqual(["continue"])
  } finally { f.manager.workpools.dispose() }
})

test("a probe that fails during runner startup has only thirty minutes of sanitized routing memory", async () => {
  let now = 1000
  const f = fixture([next], () => now)
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    const fake = present(f.runner.handles.get(result.task_id))
    f.runner.startError = new Error("private runner exception")
    const done = f.manager.waitFor(result.task_id)
    fake.settle({ status: "error", failure: { kind: "child-turn-failed", message: "Weekly usage limit reached. Resets at 2099-10-29T04:27:07Z" } })
    await done
    expect(f.memory.accountSpent("test")).toBe(true)
    expect(f.memory.spentReason("test", "first")).not.toContain("private runner exception")
    expect(f.memory.probeOf(result.task_id)).toBeUndefined()
    now += 30 * 60_000
    expect(f.memory.accountSpent("test")).toBe(false)
  } finally { f.manager.workpools.dispose() }
})

test.each(["stopped", "moved"] as const)("a %s handoff leaves no probe entry", async (mode) => {
  const f = fixture([next])
  try {
    const result = await f.manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected start")
    const fake = present(f.runner.handles.get(result.task_id))
    let intercepted = false
    f.intercept((record) => {
      if (intercepted) return record
      intercepted = true
      return mode === "stopped"
        ? { ...record, status: "cancelled" }
        : { ...record, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }
    })
    const ended = mode === "stopped" ? f.manager.waitFor(result.task_id) : fake.waitForUnsubscription()
    fake.settle({ status: "error", failure: { kind: "child-turn-failed", message: "Weekly usage limit reached" } })
    await ended
    expect(intercepted).toBe(true)
    expect(f.memory.probeOf(result.task_id)).toBeUndefined()
    expect(f.runner.startedSpecs).toHaveLength(1)
  } finally { f.manager.workpools.dispose() }
})

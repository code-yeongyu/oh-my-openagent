import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskManager } from "../../manager/manager"
import { TaskConcurrency } from "../../manager/concurrency"
import { createInProcessManagedRunner } from "../../manager/runner"
import type { TaskManager } from "../../manager"
import { InProcessRunner, type ChildSession } from "../../runners/in-process"
import { createTaskRecordStore } from "../../store"
import { runTaskOutput } from "../output/output"
import { runTaskCancel } from "../control/cancel"
import { buildTaskExecute } from "./execute"
import { TaskToolParams } from "./params"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function bounded(event: Promise<void>): Promise<void> {
  const signal = AbortSignal.timeout(20_000)
  let abort = () => {}
  const timeout = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
  })
  try { await Promise.race([event, timeout]) }
  finally { signal.removeEventListener("abort", abort) }
}

function tree(levels: number, holdLeaf = false, batch = false, promote = false) {
  const project = mkdtempSync(join(tmpdir(), "lease-parking-"))
  roots.push(project)
  const store = createTaskRecordStore({ project_dir: project })
  const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 1 })
  const begin = deferred()
  const leafEntered = deferred()
  const finishLeaf = deferred()
  const parentResumed = deferred()
  const finishParent = deferred()
  const deadlines: Array<() => void> = []
  let manager: TaskManager
  const execute = buildTaskExecute({
    get manager() { return manager }, omoConfig: {}, agents: {},
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
    resolveAncestry: (sessionId) => {
      const record = store.list().records.find((entry) => entry.child_session_id === sessionId)
      return { rootSessionId: "root", depth: record?.depth ?? 0 }
    },
  }, {
    env: promote ? { PI_PROMPT_CACHE_SAFE_WAIT_SECONDS: "60" } : {},
    scheduleDeadline: (callback) => {
      deadlines.push(callback)
      return () => {}
    },
  })
  const task = { name: "task", label: "Task", description: "Spawn a fixture child", parameters: TaskToolParams, execute }
  // Ordinary children exclude task-family tools and max_depth defaults to 1. This fixture
  // explicitly grants task through memberScopedTools (the team-member bypass) and uses max_depth: 3.
  const runner = createInProcessManagedRunner(new InProcessRunner({
    createSession: async (options): Promise<ChildSession> => {
      const sessionId = options.sessionManager!.getSessionId()
      const controller = new AbortController()
      let final: string | undefined
      return {
        sessionId,
        prompt: async (text) => {
          await begin.promise
          const level = Number(/level=(\d+)/.exec(text)?.[1])
          if (level < levels) {
            expect(options.customTools?.find((tool) => tool.name === "task")).toBe(task)
            const item = { prompt: `level=${level + 1}`, category: "quick" }
            const result = await task.execute("spawn", batch ? { tasks: [item, item] } : item,
              controller.signal, undefined, { cwd: project, sessionManager: { getSessionId: () => sessionId } })
            const expectedStatus = promote ? (batch ? "running" : "pending") : "completed"
            expect(result.details.status).toBe(controller.signal.aborted ? "cancelled" : expectedStatus)
            if (promote) {
              expect(result.details.run_in_background).toBe(true)
              parentResumed.resolve()
              await finishParent.promise
            }
          } else {
            leafEntered.resolve()
            if (holdLeaf) await finishLeaf.promise
          }
          final = "complete"
        },
        abort: async () => { controller.abort(); finishLeaf.resolve(); finishParent.resolve() },
        steer: async () => {}, followUp: async () => {}, subscribe: () => () => {},
        getLastAssistantText: () => final, dispose: () => {},
      }
    },
  }))
  manager = createTaskManager({
    store, concurrency, cwd: project,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, max_depth: 3 }),
    planner: () => ({ kind: "resolved", plan: { model: "fixture/model", category: "quick" } }),
    runners: { "in-process": { start: (spec) => runner.start({ ...spec, memberScopedTools: [task] }) }, process: runner },
  })
  return { manager, store, concurrency, begin, leafEntered, finishLeaf, parentResumed, finishParent, deadlines,
    start: () => manager.start({ prompt: "level=1", category: "quick", depth: 1, parent_session_id: "root", memberScopedTools: [task] }),
  }
}

async function completes(levels: number, batch = false) {
  const fixture = tree(levels, false, batch)
  const parent = await fixture.start()
  if (parent.kind !== "started") throw new Error(JSON.stringify(parent))
  const waiting = fixture.manager.waitFor(parent.task_id, { signal: AbortSignal.timeout(20_000) })
  fixture.begin.resolve()
  try {
    const record = await waiting.catch((cause: unknown) => {
      const diagnostics = fixture.manager.list({ scope: "all" }).map(({ record, queue_position }) =>
        ({ task: record.task_id, status: record.status, queuePosition: queue_position }))
      throw new Error(`spawn-tree deadlock: ${JSON.stringify(diagnostics)}`, { cause })
    })
    expect(record.status).toBe("completed")
    expect(fixture.concurrency.getCount("fixture/model")).toBe(0)
  } finally {
    for (const { record } of fixture.manager.list({ scope: "all" })) await fixture.manager.cancelTask(record.task_id)
  }
}

test("real runner: P foreground-waits for C at cap 1 and completes", () => completes(2), 25_000)
test("real runner: P -> C -> G completes at cap 1", () => completes(3), 25_000)
test("real runner: foreground batch frees the parent's lease", () => completes(2, true), 25_000)

test.each([[false], [true]])("promotion resumes the parent over cap without waiting for its child (batch=%s)", async (batch) => {
  const fixture = tree(2, true, batch, true)
  const parent = await fixture.start()
  if (parent.kind !== "started") throw new Error(JSON.stringify(parent))
  const entered = bounded(fixture.leafEntered.promise)
  const resumed = bounded(fixture.parentResumed.promise)
  fixture.begin.resolve()
  try {
    await entered
    expect(fixture.deadlines).toHaveLength(batch ? 2 : 1)
    for (const fire of fixture.deadlines) fire()
    await resumed
    const output = await runTaskOutput({ manager: fixture.manager, stateDir: fixture.store.stateDir }, { task_id: parent.task_id }, "root")
    expect(output.details).toMatchObject({ kind: "status", snapshot: { lease: "held" } })
    expect(fixture.concurrency.getCount("fixture/model")).toBe(2)
    fixture.finishParent.resolve()
    await fixture.manager.waitFor(parent.task_id, { signal: AbortSignal.timeout(20_000) })
    expect(fixture.concurrency.getCount("fixture/model")).toBe(1)
    fixture.finishLeaf.resolve()
    for (const { record } of fixture.manager.list({ scope: "all" })) await fixture.manager.waitFor(record.task_id, { signal: AbortSignal.timeout(20_000) })
    expect(fixture.concurrency.hasFreeSlot("fixture/model")).toBe(true)
  } finally {
    fixture.finishParent.resolve()
    fixture.finishLeaf.resolve()
    for (const { record } of fixture.manager.list({ scope: "all" })) await fixture.manager.cancelTask(record.task_id)
  }
}, 25_000)

test("task_output shows parked; task_cancel drops a parked parent without reacquiring", async () => {
  const fixture = tree(2, true)
  const parent = await fixture.start()
  if (parent.kind !== "started") throw new Error(JSON.stringify(parent))
  const entered = bounded(fixture.leafEntered.promise)
  fixture.begin.resolve()
  try {
    await entered
    const output = await runTaskOutput({ manager: fixture.manager, stateDir: fixture.store.stateDir }, { task_id: parent.task_id }, "root")
    expect(output.details).toMatchObject({ kind: "status", snapshot: { lease: "parked" } })
    const epoch = fixture.manager.get(parent.task_id)!.notification.run_epoch
    await runTaskCancel(fixture.manager, { task_id: parent.task_id })
    fixture.finishLeaf.resolve()
    for (const { record } of fixture.manager.list({ scope: "all" })) await fixture.manager.waitFor(record.task_id, { signal: AbortSignal.timeout(20_000) })
    expect(fixture.concurrency.leaseState(parent.task_id, epoch)).toBeUndefined()
    expect(fixture.concurrency.hasFreeSlot("fixture/model")).toBe(true)
  } finally {
    fixture.finishLeaf.resolve()
    for (const { record } of fixture.manager.list({ scope: "all" })) await fixture.manager.cancelTask(record.task_id)
  }
}, 25_000)

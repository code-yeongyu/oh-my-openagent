import { afterEach, expect, test } from "bun:test"
import { readdirSync, renameSync } from "node:fs"
import { join } from "node:path"

import { configureSharedSubunitLogger } from "@oh-my-opencode/utils"

import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { runTaskOutput } from "../tools/output/output"
import { baseSpec, cleanupProjects, FakeRunner, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)
afterEach(() => configureSharedSubunitLogger(undefined))

test.each(["bookkeeping", "start"] as const)(
  "#given a permanently held %s record rename #when spawning #then failure is terminal and capacity is reusable",
  async (stage) => {
    // given
    const project = tempProject()
    let attempts = 0
    let blocked = true
    let elapsed = 0
    const runner = new FakeRunner()
    const logs: string[] = []
    configureSharedSubunitLogger((message, data) => logs.push(`${message} ${JSON.stringify(data)}`))
    const durableStore = createTaskRecordStore({ project_dir: project }, {
      platform: "win32",
      rename: (from, to) => {
        attempts += 1
        if (blocked && String(to).endsWith(".json") && (stage === "bookkeeping" || attempts > 1)) {
          throw Object.assign(new Error("EPERM: rename '/Users/private-owner/state/held.json'"), {
            code: "EPERM", errno: -4048, path: "/Users/private-owner/state/held.json",
          })
        }
        renameSync(from, to)
      },
      sleep: (ms) => { elapsed += ms },
    })
    const store = {
      ...durableStore,
      remove: () => { throw Object.assign(new Error("held target cannot be deleted"), { code: "EPERM" }) },
    }
    const { manager } = makeManager({
      project, store, inProcess: runner, config: settings({ default_concurrency: 1, max_depth: 1 }),
    })

    // when
    const failed = await manager.start(baseSpec({ name: "held-record", run_in_background: true }))

    // then
    expect(failed.kind).toBe("start_failed")
    if (failed.kind !== "start_failed") throw new Error("expected typed start_failed")
    expect(failed.error_message).not.toBe("")
    expect(store.load(failed.task_id)?.status).toBe("error")
    expect(store.load(failed.task_id)?.residency_state).toBe("disposed")
    const output = await runTaskOutput({ manager, stateDir: store.stateDir }, { task_id: failed.task_id }, "parent-1")
    const rendered = JSON.stringify(output)
    expect(rendered).toContain("EPERM")
    expect(rendered).toContain("-4048")
    expect(rendered).toContain("held.json")
    expect(rendered).not.toContain("/Users/private-owner")
    const failures = logs.filter(line => line.includes("spawn") && line.includes("EPERM"))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("-4048")
    expect(failures[0]).toContain("held.json")
    expect(failures[0]).not.toContain("/Users/private-owner")
    expect(createTaskRecordStore({ project_dir: project }).list().records.every(record => record.status !== "pending")).toBe(true)
    expect(runner.handles.size).toBe(0)
    expect(manager.residentTaskIds()).toEqual([])
    expect(elapsed).toBeGreaterThanOrEqual(1_000)
    expect(readdirSync(join(store.stateDir, "tasks")).filter(file => file.endsWith(".tmp"))).toEqual([])
    blocked = false
    const next = await manager.start(baseSpec({ name: "held-record" }))
    expect(next.kind).toBe("started")
    if (next.kind !== "started") throw new Error("expected reusable capacity")
    expect(next.name).toBe("held-record")
    runner.handles.get(next.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(next.task_id)
  },
)

test.each(["launch", "refusal"] as const)(
  "#given an unexpected %s transition invariant #when spawning #then task_output and one log preserve its distinct cause",
  async (stage) => {
    // given
    const inner = createTaskRecordStore({ project_dir: tempProject() })
    const logs: string[] = []
    configureSharedSubunitLogger((message, data) => logs.push(`${message} ${JSON.stringify(data)}`))
    let claimedId = ""
    const store: TaskRecordStore = {
      ...inner,
      save(record) { claimedId = record.task_id; inner.save(record) },
      replace(record) {
        if (stage === "refusal") throw new Error("initial persistence fault")
        inner.replace(record)
      },
      transition(taskId, transition) {
        if (stage === "launch") throw new Error("spawn bookkeeping failure transitions were not applied")
        return { ...inner.transition(taskId, transition), applied: false }
      },
    }
    const { manager, inProcess } = makeManager({ store })
    // when
    await manager.start(baseSpec({ name: "invariant" }))
    // then
    const output = await runTaskOutput({ manager, stateDir: store.stateDir }, { task_id: claimedId }, "parent-1")
    expect(JSON.stringify(output)).toContain("transitions were not applied")
    expect(JSON.stringify(output)).toContain("unexpected")
    expect(inProcess.startedSpecs).toEqual([])
    const failures = logs.filter(line => line.includes("transitions were not applied"))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("unexpected")
  },
)

test("#given a newer live child #when an old launch failure is fenced out #then its name remains reserved", async () => {
  // given
  const inner = createTaskRecordStore({ project_dir: tempProject() })
  let intercept = true
  const store: TaskRecordStore = {
    ...inner,
    transition(taskId, transition) {
      if (intercept && transition.type === "start") {
        intercept = false
        inner.mutate(taskId, record => ({ ...record, status: "running", child_session_id: "newer-child" }))
        throw Object.assign(new Error("obsolete write failed"), { code: "EPERM" })
      }
      return inner.transition(taskId, transition)
    },
  }
  const { manager } = makeManager({ store })
  // when
  const obsolete = await manager.start(baseSpec({ name: "live" }))
  const next = await manager.start(baseSpec({ name: "live" }))
  // then
  expect(obsolete.kind).toBe("start_failed")
  if (obsolete.kind !== "start_failed") throw new Error("expected obsolete failure")
  expect(store.load(obsolete.task_id)?.status).toBe("running")
  expect(next.kind).toBe("started")
  if (next.kind !== "started") throw new Error("expected next task")
  expect(next.name).toBe("live-2")
})

test("#given a queued child with a permanent start-write refusal #when capacity frees #then its existing waiter receives terminal failure", async () => {
  // given
  const project = tempProject()
  let blockedId: string | undefined
  const store = createTaskRecordStore({ project_dir: project }, {
    platform: "win32",
    rename: (from, to) => {
      if (blockedId !== undefined && String(to).endsWith(`${blockedId}.json`)) {
        throw Object.assign(new Error("synthetic held queued record"), { code: "EPERM" })
      }
      renameSync(from, to)
    },
    sleep: () => {},
  })
  const runner = new FakeRunner()
  const { manager } = makeManager({
    project, store, inProcess: runner, config: settings({ default_concurrency: 1, max_depth: 1 }),
  })
  const active = await manager.start(baseSpec())
  const queued = await manager.start(baseSpec({ run_in_background: true }))
  if (active.kind !== "started" || queued.kind !== "started") throw new Error("expected admitted and queued tasks")
  expect(queued.status).toBe("pending")
  blockedId = queued.task_id
  const controller = new AbortController()
  const waiting = manager.waitFor(queued.task_id, { signal: controller.signal })
  const watchdog = setTimeout(() => controller.abort(new Error("queued start failure did not settle")), 2_000)
  try {
    // when
    runner.handles.get(active.task_id)?.settle({ status: "completed", finalResponse: "done" })
    const result = await waiting
    // then
    expect(result.status).toBe("error")
    expect(result.error_message).not.toBe("")
    expect(store.load(queued.task_id)?.status).toBe("error")
    expect(runner.handles.has(queued.task_id)).toBe(false)
    // Retaining the terminal record preserves its background origin, not a live registration.
    expect(manager.wasBackground(queued.task_id)).toBe(true)
    expect(manager.get(queued.task_id)?.residency_state).toBe("disposed")
    expect(manager.residentTaskIds()).not.toContain(queued.task_id)
    expect(readdirSync(join(store.stateDir, "tasks")).filter(file => file.endsWith(".tmp"))).toEqual([])
  } finally {
    clearTimeout(watchdog)
  }
})

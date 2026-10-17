import { afterEach, describe, expect, test } from "bun:test"

import { EventEmitter, once } from "node:events"
import { createTaskRecordStore } from "../store"
import { coldReviveHarness } from "../lifecycle/__fixtures__/cold-revive-harness"
import { FakeRunner, baseSpec, cleanupProjects, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// Regression for the inherited todo-9 defect: #releaseSlot was guarded by a task_id-only Set that
// was never reset, so a revived task that re-acquires a slot could never release it again (the
// later release collapsed to a no-op) and leaked the slot forever. The guard is now keyed by
// run_epoch, so each revive's occupancy releases independently.
describe("TaskManager revive concurrency slot", () => {
  test("#given a cold revived child #when interrupted twice and resumed #then each epoch releases its admitted lane", async () => {
    const h = coldReviveHarness()
    try {
      expect((await h.send()).kind).toBe("revived")
      expect((await h.manager.interruptTask(h.record.task_id)).kind).toBe("interrupted")
      expect((await h.manager.interruptTask(h.record.task_id)).kind).toBe("noop")
      expect((await h.send("AGAIN")).kind).toBe("revived")
      expect(h.store.load(h.record.task_id)?.notification.run_epoch).toBe(2)
      const terminal = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
      h.fake.settle({ status: "completed", finalResponse: "DONE" })
      await terminal
      const next = await h.manager.start({ prompt: "next", parent_session_id: "parent", depth: 1 })
      expect(next).toMatchObject({ kind: "started", status: "running" })
      if (next.kind === "started") await h.manager.cancelTask(next.task_id)
    } finally { await h.dispose() }
  })

  test("#given single concurrency #when a revived task completes #then it releases its slot and a queued task starts", async () => {
    // given a single-slot manager: task A runs, completes (slot freed), then is revived
    const inProcess = new FakeRunner()
    const events = new EventEmitter()
    const project = tempProject()
    const backing = createTaskRecordStore({ project_dir: project })
    const observed = { ...backing, transition: (...args: Parameters<typeof backing.transition>) => {
      const result = backing.transition(...args)
      if (result.applied && result.record.status === "running") events.emit(`running:${result.record.task_id}`)
      return result
    } }
    const { manager, store } = makeManager({
      inProcess, project, store: observed,
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })
    const a = await manager.start(baseSpec({ name: "a" }))
    if (a.kind !== "started") throw new Error("expected started")
    const firstTerminal = manager.waitFor(a.task_id, { signal: AbortSignal.timeout(5000) })
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "first" })
    await firstTerminal
    expect(store.load(a.task_id)?.status).toBe("completed")

    const revived = await manager.continueTask(a.task_id, "again")
    if (revived.kind !== "continued") throw new Error("expected continued")
    expect(revived.delivered).toBe("revive")
    expect(store.load(a.task_id)?.notification.run_epoch).toBe(1)

    // when a second task is queued behind the revived (slot-occupying) task A
    const b = await manager.start(baseSpec({ name: "b" }))
    if (b.kind !== "started") throw new Error("expected started")
    expect(b.status).toBe("pending")

    // when the revived task A completes a second time, releasing the re-acquired slot
    const nextRunning = once(events, `running:${b.task_id}`, { signal: AbortSignal.timeout(5000) })
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "second" })
    await nextRunning

    // then the queued task B is granted the freed slot and starts running (no leaked slot)
    expect(store.load(b.task_id)?.status).toBe("running")
  })

  test("#given single concurrency #when a task is interrupted #then its slot is released for the next task", async () => {
    // given a single-slot manager with a running task A
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({
      inProcess,
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })
    const a = await manager.start(baseSpec({ name: "a" }))
    if (a.kind !== "started") throw new Error("expected started")

    // when A is interrupted (a terminal, slot-freeing transition)
    const interrupted = await manager.interruptTask(a.task_id)
    expect(interrupted.kind).toBe("interrupted")

    // then a new task B acquires the freed slot immediately (running, not queued)
    const b = await manager.start(baseSpec({ name: "b" }))
    if (b.kind !== "started") throw new Error("expected started")
    expect(b.status).toBe("running")
    expect(store.load(a.task_id)?.status).toBe("interrupted")
  })
})

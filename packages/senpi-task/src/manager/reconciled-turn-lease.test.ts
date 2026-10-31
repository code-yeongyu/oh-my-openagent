import { afterEach, describe, expect, test } from "bun:test"

import type { ReconciledTurnNotice } from "../runners/rpc-host/reconcile-turn"
import { RunnerError } from "../runners/in-process"
import type { ManagedChildHandle } from "./child-handle"
import type { TaskConcurrency } from "./concurrency"
import type { TaskLeaseHolderView, TaskManager } from "./types"
import type { ManagedStartSpec } from "./types"
import { cleanupProjects, FakeRunner, makeHandle, makeManager, settings, type FakeHandle } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

const INTERRUPTED: ReconciledTurnNotice = {
  kind: "interrupted",
  reason: "The child's previous turn was interrupted; its continuation is being delivered.",
}

type ReconcilingChild = FakeHandle & { reconcile(notice: ReconciledTurnNotice): void }

/** A child whose host reconciles its turn after a reconnect, the way a loaded task host does (#11677). */
class ReconcilingRunner extends FakeRunner {
  readonly children = new Map<string, ReconcilingChild>()
  failOpen: ((spec: ManagedStartSpec) => boolean) | undefined

  override start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    if (this.failOpen?.(spec) === true) {
      return Promise.reject(new RunnerError({ kind: "session_unavailable", reason: "open_failed", message: "could not open" }))
    }
    const fake = makeHandle(spec.taskId)
    const listeners = new Set<(notice: ReconciledTurnNotice) => void>()
    const handle: ManagedChildHandle = {
      ...fake.handle,
      onReconciled: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    this.children.set(spec.taskId, {
      ...fake,
      handle,
      reconcile: (notice) => { for (const listener of [...listeners]) listener(notice) },
    })
    return Promise.resolve(handle)
  }
}

/** Yields event-loop turns until the condition holds; bounded by turns, never by wall-clock time. */
async function turnsUntil(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 500; turn++) {
    if (condition()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`never reached: ${what}`)
}

function limiter(manager: TaskManager): TaskConcurrency {
  if (manager.concurrency === undefined) throw new Error("the manager exposes no limiter")
  return manager.concurrency
}

function leaseHolders(manager: TaskManager): readonly TaskLeaseHolderView[] {
  if (manager.leaseHolders === undefined) throw new Error("the manager exposes no lease view")
  return manager.leaseHolders()
}

const SPEC = { prompt: "work", parent_session_id: "parent-1", depth: 1, category: "quick", run_in_background: true } as const

describe("task limiter leases across host turn reconciliation (#11677)", () => {
  test("#given children whose host reconciles and self-resumes their turns #when every child finishes #then every lease is free, the queue drains and a following child runs", async () => {
    // Given a limiter as wide as the burst's first wave, every slot taken, and more children queued.
    const runner = new ReconcilingRunner()
    const limit = 3
    const { manager, store } = makeManager({ inProcess: runner, config: settings({ global_concurrency: limit, default_concurrency: 100, max_depth: 1 }) })
    const first: string[] = []
    for (let index = 0; index < limit; index++) {
      const started = await manager.start(SPEC)
      if (started.kind !== "started" || started.status !== "running") throw new Error(`child ${index} did not start`)
      first.push(started.task_id)
    }
    const queued: string[] = []
    for (let index = 0; index < limit; index++) {
      const started = await manager.start(SPEC)
      if (started.kind !== "started" || started.status !== "pending") throw new Error(`child ${index} was not queued`)
      queued.push(started.task_id)
    }
    expect(limiter(manager).getRetainedKeyCounts().leases).toBe(limit)

    // When each running child's host reconnects twice: the turn is reconciled as interrupted, the child
    // resumes on its own under the next run epoch, and only then does it finish.
    for (const taskId of first) {
      const child = runner.children.get(taskId)
      if (child === undefined) throw new Error(`no child for ${taskId}`)
      for (let reconnect = 0; reconnect < 2; reconnect++) {
        const before = store.load(taskId)?.notification.run_epoch ?? -1
        child.reconcile(INTERRUPTED)
        expect(store.load(taskId)?.status).toBe("interrupted")
        child.selfResume()
        await turnsUntil(() => store.load(taskId)?.status === "running" && (store.load(taskId)?.notification.run_epoch ?? -1) > before,
          `${taskId} resumed after reconnect ${reconnect}`)
      }
      child.settle({ status: "completed", finalResponse: "done" })
      await turnsUntil(() => store.load(taskId)?.status === "completed", `${taskId} completed`)
    }

    // Then the finished children hold no lease and every queued child got its slot.
    await turnsUntil(() => queued.every((taskId) => store.load(taskId)?.status === "running"), "queued children running")
    expect(limiter(manager).getRetainedKeyCounts().leases).toBe(limit)
    for (const taskId of queued) {
      runner.children.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
      await turnsUntil(() => store.load(taskId)?.status === "completed", `${taskId} completed`)
    }
    expect(limiter(manager).getRetainedKeyCounts().leases).toBe(0)
    const following = await manager.start(SPEC)
    expect(following.kind === "started" ? following.status : following.kind).toBe("running")
  })

  test("#given a resumed child whose superseded turn also settles late #when it finishes #then its lease is released once and no other child's lease is freed", async () => {
    // Given two running children, one of them reconciled and self-resumed once.
    const runner = new ReconcilingRunner()
    const { manager, store } = makeManager({ inProcess: runner, config: settings({ global_concurrency: 2, default_concurrency: 100, max_depth: 1 }) })
    const a = await manager.start(SPEC)
    const b = await manager.start(SPEC)
    if (a.kind !== "started" || b.kind !== "started") throw new Error("children did not start")
    const child = runner.children.get(a.task_id)
    if (child === undefined) throw new Error("no child")
    child.reconcile(INTERRUPTED)
    child.selfResume()
    await turnsUntil(() => store.load(a.task_id)?.status === "running" && store.load(a.task_id)?.resumed_run_epoch !== undefined, "a resumed")
    // The lease-holder view names one lease for a, held by its current run behind a live child.
    expect(leaseHolders(manager).filter((holder) => holder.task_id === a.task_id)).toEqual([{
      task_id: a.task_id,
      run_epoch: store.load(a.task_id)?.notification.run_epoch ?? -1,
      model: "anthropic/claude",
      phase: "held",
      status: "running",
      residency_state: "resident",
      record_run_epoch: store.load(a.task_id)?.notification.run_epoch ?? -1,
      live: true,
    }])

    // When the resumed run finishes and a stale settle for the superseded turn arrives after it.
    child.settle({ status: "completed", finalResponse: "done" })
    await turnsUntil(() => store.load(a.task_id)?.status === "completed", "a completed")
    child.settle({ status: "completed", finalResponse: "late" })
    await turnsUntil(() => true, "late settle observed")

    // Then exactly the other child's lease remains.
    expect(limiter(manager).getRetainedKeyCounts().leases).toBe(1)
    expect(limiter(manager).leaseState(b.task_id, store.load(b.task_id)?.notification.run_epoch ?? -1)).toBe("held")
  })

  test("#given a burst where a subset of opens fail #when the rest finish #then no failed open holds a lease", async () => {
    // Given every other open refused with open_failed, at more than the limit's width.
    const runner = new ReconcilingRunner()
    let opens = 0
    runner.failOpen = () => opens++ % 2 === 0
    const limit = 2
    const { manager, store } = makeManager({ inProcess: runner, config: settings({ global_concurrency: limit, default_concurrency: 100, max_depth: 1 }) })
    const started = []
    for (let index = 0; index < limit * 3; index++) started.push(await manager.start(SPEC))

    // When every child that did open finishes.
    for (;;) {
      const live = [...runner.children.entries()].filter(([taskId]) => store.load(taskId)?.status === "running")
      if (live.length === 0) break
      for (const [taskId, child] of live) {
        child.settle({ status: "completed", finalResponse: "done" })
        await turnsUntil(() => store.load(taskId)?.status === "completed", `${taskId} completed`)
      }
    }

    // Then nothing is left holding or waiting for a lease.
    const statuses = started.map((result) => result.kind === "started" ? store.load(result.task_id)?.status : result.kind)
    expect(statuses.every((status) => status === "completed" || status === "error" || status === "start_failed")).toBe(true)
    expect(statuses.filter((status) => status === "completed").length).toBeGreaterThan(0)
    expect(limiter(manager).getRetainedKeyCounts()).toEqual({ lanes: 0, queues: 0, leases: 0 })
  })
})

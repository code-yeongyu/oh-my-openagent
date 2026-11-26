// #10057 review finding 1: a processing error inside an open-ended admission batch (a journal or
// attachment fault while a start is handled, a fold fault while the batch waits) must not end the
// batch while sibling starts are still in flight, and must never be lost when another event wins.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import type { ManagerStartSpec } from "../manager/types"
import type { TaskRecord } from "../state"
import type { CancelOutcome } from "../steering/types"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import {
  cleanupTempProjects,
  deferred,
  definition,
  FrontierFakeManager,
  frontierFixture,
  node,
  timeout,
  whenNodeState,
  type FakeOptions,
} from "./scheduler-frontier.test-harness"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupTempProjects)

// Attaching a node subscribes to its child's settlement; this manager fails that subscription for
// one node, which is an attachment fault raised while the batch handles that node's start.
class FaultyAttachManager extends FrontierFakeManager {
  readonly attachFailed = deferred<undefined>()
  readonly #faultyNode: string

  constructor(faultyNode: string, options: FakeOptions = {}) {
    super(options)
    this.#faultyNode = faultyNode
  }

  override waitFor(taskId: string): Promise<TaskRecord> {
    if (String(this.get(taskId)?.owner?.nodeId) === this.#faultyNode) {
      this.attachFailed.resolve(undefined)
      throw new Error(`injected attachment fault for ${this.#faultyNode}`)
    }
    return super.waitFor(taskId)
  }
}

function settlement(running: Promise<unknown>) {
  const state = { settled: false }
  const outcome = running.then(
    () => "completed",
    (error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`,
  )
  void outcome.then(() => {
    state.settled = true
  })
  return { state, outcome }
}

// Every microtask the failure path queues has run by the next macrotask.
const drainMicrotasks = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

describe("DAG admission batch keeps its lifetime through processing errors (#10057 review finding 1)", () => {
  test("#given a sibling start still in flight #when attaching another started node fails #then the run waits for the sibling, writes nothing for it, and rejects with the attachment error", async () => {
    // given - a's attachment fails; slow's start hangs on a busy host.
    const hostBusy = deferred<undefined>()
    const slowAttempted = deferred<undefined>()
    const manager = new FaultyAttachManager("a", {
      beforeStart: (nodeId) => {
        if (nodeId !== "slow") return undefined
        slowAttempted.resolve(undefined)
        return hostBusy.promise
      },
    })
    const { scheduler, events } = frontierFixture(definition([node("a"), node("slow")]), manager)

    // when
    const { state, outcome } = settlement(scheduler.run())
    await Promise.race([
      Promise.all([slowAttempted.promise, manager.attachFailed.promise]),
      timeout("a's attachment to fail while slow's start is pending"),
    ])
    await drainMicrotasks()

    // then - the batch still owns slow's start, so the run has not settled.
    expect(state.settled).toBe(false)
    hostBusy.resolve(undefined)
    expect(await Promise.race([outcome, timeout("the run to settle")])).toBe(
      "rejected: injected attachment fault for a",
    )
    await manager.whenStarted("slow")
    await drainMicrotasks()
    // and - the retiring batch attached nothing after the first error.
    const attached = events()
      .filter((event) => event.type === "dag.node.task-attached")
      .map((event) => String(event.nodeId))
    expect(attached).toEqual(["a"])
  })

  test("#given a sibling start still in flight #when folding a settled child fails #then the run waits for the sibling, writes nothing for it, and rejects with the fold error", async () => {
    // given - slow's start hangs; a is attached and running.
    const hostBusy = deferred<undefined>()
    const manager = new FrontierFakeManager({
      beforeStart: (nodeId) => (nodeId === "slow" ? hostBusy.promise : undefined),
    })
    const { scheduler, events } = frontierFixture(definition([node("a"), node("slow")]), manager)
    const { state, outcome } = settlement(scheduler.run())
    await Promise.race([whenNodeState(scheduler, "a", "running"), timeout("a to be attached")])

    // when - a's settlement reports a nonterminal record, which the fold rejects.
    manager.complete("a", "running")
    await drainMicrotasks()

    // then
    expect(state.settled).toBe(false)
    hostBusy.resolve(undefined)
    expect(await Promise.race([outcome, timeout("the run to settle")])).toBe(
      "rejected: TaskManager.waitFor returned nonterminal task task-1",
    )
    await manager.whenStarted("slow")
    await drainMicrotasks()
    const attached = events()
      .filter((event) => event.type === "dag.node.task-attached")
      .map((event) => String(event.nodeId))
    expect(attached).toEqual(["a"])
  })

  // x's start is answered by hand with a child the manager cannot subscribe to, so its attachment
  // fault can land in the same microtask drain as a's fold.
  class HandReleasedStartManager extends FrontierFakeManager {
    readonly xAttempted = deferred<undefined>()
    #releaseX: (() => void) | undefined
    override async startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
      if (String(owner.nodeId) !== "x") return super.startOwned(spec, owner)
      this.attempts.push("x")
      this.xAttempted.resolve(undefined)
      return new Promise<OwnedStartResult>((resolve) => {
        this.#releaseX = () =>
          resolve({ kind: "started", reused: false, task_id: "task-x", status: "running", name: "x" })
      })
    }
    releaseX(): void {
      this.#releaseX?.()
    }
  }

  test.each([0, 1, 2, 3, 4, 5])(
    "#given a fold competing with a failed attachment %i microtask(s) later #when the fold wins the batch's wait #then the attachment error still rejects the run",
    async (hops) => {
      // given - a attached and running, x's start pending.
      const manager = new HandReleasedStartManager()
      const { scheduler } = frontierFixture(definition([node("a"), node("x")]), manager)
      const { outcome } = settlement(scheduler.run())
      await Promise.race([
        Promise.all([whenNodeState(scheduler, "a", "running"), manager.xAttempted.promise]),
        timeout("a to be attached and x to be probed"),
      ])

      // when - a completes, and x's start returns `hops` microtasks later and fails to attach.
      manager.complete("a")
      for (let index = 0; index < hops; index += 1) await Promise.resolve()
      manager.releaseX()

      // then - the first processing error is what the run reports, whichever event won.
      expect(await Promise.race([outcome, timeout("the run to settle")])).toBe("rejected: unknown fake task task-x")
    },
  )
})

// A cancel stops the child it asks for, so whatever is still live afterwards was never asked.
class CancellableFaultyAttachManager extends FaultyAttachManager {
  override async cancelTask(taskId: string): Promise<CancelOutcome> {
    const record = this.get(taskId)
    if (record === undefined) throw new Error(`unknown fake task ${taskId}`)
    this.complete(String(record.owner?.nodeId), "cancelled")
    return { kind: "cancelled", task_id: taskId, previous_status: record.status }
  }
}

describe("DAG run cancel after an admission processing error (#10057 review, composed with #11381)", () => {
  test("#given an attachment fault while a sibling start is in flight #when the run is cancelled before the sibling's start returns #then the late child is stopped and the run reads cancelled", async () => {
    // given - a's attachment fails; slow's start hangs on a busy host.
    const hostBusy = deferred<undefined>()
    const slowAttempted = deferred<undefined>()
    const manager = new CancellableFaultyAttachManager("a", {
      beforeStart: (nodeId) => {
        if (nodeId !== "slow") return undefined
        slowAttempted.resolve(undefined)
        return hostBusy.promise
      },
    })
    const { scheduler } = frontierFixture(definition([node("a"), node("slow")]), manager)
    const run = settlement(scheduler.run())
    await Promise.race([
      Promise.all([slowAttempted.promise, manager.attachFailed.promise]),
      timeout("a's attachment to fail while slow's start is pending"),
    ])
    await drainMicrotasks()

    // when - the run is cancelled, then slow's start returns with a child.
    const cancel = settlement(scheduler.cancel(scheduler.snapshot().runId, "operator stop"))
    hostBusy.resolve(undefined)
    await Promise.race([manager.whenStarted("slow"), timeout("slow's start to return")])

    // then - no child the run owns is left running behind a cancelled run.
    expect(await Promise.race([cancel.outcome, timeout("the cancel to settle")])).toBe("completed")
    expect(await Promise.race([run.outcome, timeout("the run to settle")])).toBe(
      "rejected: injected attachment fault for a",
    )
    expect(scheduler.snapshot().status).toBe("cancelled")
    const live = ["a", "slow"].filter((nodeId) => {
      const status = manager.recordOf(nodeId)?.status
      return status === "pending" || status === "running" || status === "paused"
    })
    expect(live).toEqual([])
  })
})

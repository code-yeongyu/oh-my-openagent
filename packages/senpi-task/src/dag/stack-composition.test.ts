import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import { parentSessionId } from "./__fixtures__/controlled-dag-e2e"
import { completed, failed } from "./__fixtures__/controlled-runner"
import { answerOf, DEAD_HOST, THIS_HOST, unscheduledRun } from "./__fixtures__/stack-composition"
import { retryDagNodes } from "./node-retry"
import { sendToDagNode } from "./node-send"
import { createDagRecovery, type InstalledDagRun } from "./recovery"
import type { DagNodeId } from "./types"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// The stack's composition (#15125 under #11381): every entry the lower car added decides ownership
// first (acquisition, holder, lease) and then asks the upper car's child gate on the record it decided.

async function failedRunAB(extraNodes: readonly string[] = []) {
  const run = await unscheduledRun(roots, ["A", "B", ...extraNodes])
  run.runner.settle("A", completed("A"))
  run.runner.settle("B", failed("B"))
  await run.fixture.taskManager.waitFor(run.taskOf("A"))
  await run.fixture.taskManager.waitFor(run.taskOf("B"))
  return run
}

async function failedRunOwingAStop() {
  const run = await failedRunAB()
  run.write("failed", {
    A: { state: "completed", taskId: run.taskOf("A") },
    B: { state: "failed", taskId: run.taskOf("B") },
  })
  const held = run.runner.child("A").holdStops()
  void run.runner.selfResume("A")
  await held.reached
  return { run, held }
}

const sendB = (run: Awaited<ReturnType<typeof unscheduledRun>>) =>
  answerOf(() => run.reserved("send", (context) => sendToDagNode(context, run.runId, "B" as DagNodeId, "again")))

describe("send-revive asks the child gate on the record its decision acquired", () => {
  test("#given a failed run whose completed node's refused turn is not confirmed stopped #when a failed node is sent a message #then the gate refuses run_still_active, the child is never sent to, and no lease remains", async () => {
    // given
    const { run, held } = await failedRunOwingAStop()

    // when
    const answer = await sendB(run)

    // then
    expect(answer).toBe("run_still_active")
    expect(run.sendCalls).toEqual([])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    held.release()
  })

  test("#given a failed run that still owns a live child of a node an amendment removed #when a failed node is sent a message #then the gate refuses run_still_active, the child is never sent to, and no lease remains", async () => {
    // given
    const run = await failedRunAB(["X"])
    run.write("failed", {
      A: { state: "completed", taskId: run.taskOf("A") },
      B: { state: "failed", taskId: run.taskOf("B") },
    })

    // when
    const answer = await sendB(run)

    // then
    expect(answer).toBe("run_still_active")
    expect(run.sendCalls).toEqual([])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })

  test("#given a failed node that still names the task of an earlier attempt #when it is sent a message #then the gate refuses node_not_continuable, the child is never sent to, and no lease remains", async () => {
    // given
    const run = await failedRunAB()
    run.write("failed", {
      A: { state: "completed", taskId: run.taskOf("A") },
      B: { state: "failed", taskId: run.taskOf("B"), execAttempt: 1 },
    })

    // when
    const answer = await sendB(run)

    // then
    expect(answer).toBe("node_not_continuable")
    expect(run.sendCalls).toEqual([])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })
})

describe("re-entry asks the child gate on the record it acquired", () => {
  test("#given a failed run that owes a stop #when a node is retried #then the retry is refused run_still_active after taking the lease, and it gives that lease back", async () => {
    // given
    const { run, held } = await failedRunOwingAStop()
    const leaseWrites: number[] = []
    const store = new Proxy(run.fixture.store, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target)
        if (property !== "writeCheckpoint" || typeof value !== "function")
          return typeof value === "function" ? value.bind(target) : value
        return (runId: unknown, record: { readonly leaseHolderPid?: number }) => {
          if (record.leaseHolderPid !== undefined) leaseWrites.push(record.leaseHolderPid)
          return value.call(target, runId, record)
        }
      },
    })

    // when
    const answer = await answerOf(() =>
      run.reserved("retry", (context) => retryDagNodes({ ...context, store }, run.runId, ["B" as DagNodeId])),
    )

    // then
    expect(answer).toBe("run_still_active")
    expect(leaseWrites).toEqual([THIS_HOST])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.read()?.nodes.find((node) => node.id === "B")?.state).toBe("failed")
    held.release()
  })
})

describe("recovery of an interrupted run asks the child gate before it starts or reattaches", () => {
  test("#given a run left running by a dead host, with a live child of an earlier attempt whose stop stays pending and a scheduled node #when recovery claims it #then no node starts beside the live child and the superseded child is never reattached", async () => {
    // given
    const run = await unscheduledRun(roots, ["B", "C"], { connectable: true, start: ["B"] })
    const staleB = run.taskOf("B")
    run.runner.child("B").connection.lose()
    run.write(
      "running",
      { B: { state: "running", taskId: staleB, execAttempt: 1 }, C: { state: "scheduled" } },
      { leaseHolderPid: DEAD_HOST },
    )
    const reattached: string[] = []
    const installed: InstalledDagRun[] = []
    const recovery = createDagRecovery({
      store: run.fixture.store,
      taskManager: run.fixture.taskManager,
      hostPid: THIS_HOST,
      isProcessAlive: (pid) => pid === THIS_HOST,
      isRunHeldInProcess: () => false,
      reattach: (_runId, taskId) => reattached.push(taskId),
    })

    // when
    const first = await Promise.race([
      recovery
        .installPausedRuns(parentSessionId, (entry) => {
          installed.push(entry)
          entry.release()
        })
        .then(() => "recovered"),
      run.runner.whenStarted(2).then(() => "a node started beside the live child"),
    ])

    // then
    expect(first).toBe("recovered")
    expect(installed.map((entry) => entry.runId)).toEqual([run.runId])
    expect(reattached).toEqual([])
    const nodes = run.read()?.nodes ?? []
    expect(nodes.find((node) => node.id === "C")).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
    expect(nodes.find((node) => node.id === "B")?.state).not.toBe("running")
    for (const entry of installed) await entry.scheduler.suspend()
  })
})

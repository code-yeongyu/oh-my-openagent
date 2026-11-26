// A send that revives a child of a settled run this host does not hold takes the run over: it must
// acquire the run (holder rule, lease) before it touches the child, hold it while the revived node
// runs, and give the lease up in the write that folds the child's outcome (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { runId } from "./__fixtures__/reattached-run"
import { LIVE_THIRD_HOST, sendRun, THIS_HOST, type Leased } from "./__fixtures__/send-run"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG send that revives a child of a run this host does not hold", () => {
  test("#given another live process takes the run's lease at the send's decision #when the send arrives #then it is refused and the child is never touched", async () => {
    // given - the third host's lease lands the moment this host first takes the run lock
    let raced = false
    const run = sendRun(cleanupRoots, ["a", "b"], {
      wrap: (base) => ({
        ...base,
        withRunLock: (lockedRunId, operation) => {
          if (!raced && lockedRunId === runId) {
            raced = true
            const record = base.readCheckpoint<Leased>(runId)
            if (record !== null) base.writeCheckpoint(runId, { ...record, leaseHolderPid: LIVE_THIRD_HOST })
          }
          return base.withRunLock(lockedRunId, operation)
        },
      }),
    })

    // when
    const refusal = await run.refusalOf(() => run.send("a"))

    // then
    expect(raced).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(run.sends).toEqual([])
    expect(run.events()).toEqual([])
    expect(run.read()?.leaseHolderPid).toBe(LIVE_THIRD_HOST)
  })

  test("#given a revive in flight #when another host retries a node of the run #then this host's lease holds the run and the retry is refused", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a", "b"])

    // when
    const result = await run.send("a")

    // then
    expect(result.delivery).toBe("revive")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    expect(run.nodeState("a")).toBe("running")
    expect(await run.refusalOf(() => run.otherRetry("b"))).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    run.manager.complete("task-a")
    await result.settled
  })

  test("#given a revive in flight #when the revived child's outcome is folded #then the lease leaves in that same write and another host's retry is accepted", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a", "b"])
    const result = await run.send("a")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)

    // when
    run.manager.complete("task-a")
    await result.settled

    // then - the checkpoint after the fold carries the fold's own seq and no lease
    const fold = run.events().at(-1)
    expect(fold).toEqual(expect.objectContaining({ type: "dag.node.transitioned", nodeId: "a", to: "completed" }))
    expect(run.read()).toEqual(expect.objectContaining({ checkpointSeq: fold?.seq }))
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect((await run.otherRetry("b").run).status).toBe("completed")
  })

  test("#given a run this host acquires for a revive #when the task manager refuses the revive #then no lease and no running node are left", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a"], { answer: () => "refused" })

    // when
    const refusal = await run.refusalOf(() => run.send("a"))

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_continuable" }))
    expect(run.leaseAtSend).toEqual([THIS_HOST])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.nodeState("a")).toBe("failed")
    expect(run.events()).toEqual([])
  })

  test("#given a run its reviving host left with a node shown running #when this host's revive of another node is refused #then this host leaves no lease behind", async () => {
    // given - a dead host's lease, and its revived node `b` still shown running
    const run = sendRun(cleanupRoots, ["a", "b"], {
      answer: () => "refused",
      record: (failed) => ({
        ...failed,
        leaseHolderPid: 9_999_999,
        nodes: failed.nodes.map((entry) =>
          entry.id === "b" ? { ...entry, state: "running" as const, taskId: "task-b-dead" } : entry,
        ),
      }),
    })

    // when
    const refusal = await run.refusalOf(() => run.send("a"))

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_continuable" }))
    expect(run.leaseAtSend).toEqual([THIS_HOST])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })
})

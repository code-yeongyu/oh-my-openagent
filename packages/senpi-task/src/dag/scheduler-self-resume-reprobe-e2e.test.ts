// #15133 on #15134: a residency-denied dependent is re-probed mid-batch when a fold frees a slot. If its
// dependency re-opened meanwhile (the dependency's child started a turn on its own and the node
// follows it), the dependent leaves the parked denials and waits for the resumed outcome instead of
// launching on the earlier result.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import type { AdmitResident } from "../manager/types"
import { readDagNodeResult } from "./results"
import { cleanupSelfResumeRoots, selfResumeE2e } from "./scheduler-self-resume-e2e.test-harness"
import { drainMicrotasks, settlement, timeout } from "./scheduler-frontier.test-harness"
import type { DagNodeId, DagRunEvent } from "./types"
import { categoryNode } from "./__fixtures__/controlled-dag-e2e"
import { completed, failed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupSelfResumeRoots)

type Harness = Awaited<ReturnType<typeof selfResumeE2e>>
type Transition = Extract<DagRunEvent, { readonly type: "dag.node.transitioned" }>

function whenTransition(h: Harness, nodeId: string, matches: (event: Transition) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = h.scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || !matches(event)) return
      unsubscribe()
      resolve()
    })
  })
}

function transitionsOf(h: Harness, nodeId: string): readonly string[] {
  return h.fixture.store
    .readEvents(h.runId, 0, { limit: 500 })
    .events.flatMap((event) =>
      event.type === "dag.node.transitioned" && String(event.nodeId) === nodeId
        ? [`${event.from}->${event.to}:${event.reason.kind}`]
        : [],
    )
}

const startsOf = (h: Harness, nodeId: string): number => h.starts.calls.filter((entry) => entry === nodeId).length

// A, X and S start in one batch, S held at the gate so the batch stays open. A completes, its
// dependent B is admitted in the same batch and denied a resident slot, so B is parked.
async function dependentParkedInOpenBatch() {
  let denyResidency = false
  const admit: AdmitResident = () =>
    Promise.resolve(
      denyResidency
        ? {
            kind: "rejected",
            message: "resident child cap reached",
            residents: [{ task_id: "task-elsewhere", name: "elsewhere", status: "running" }],
          }
        : { kind: "admitted" },
    )
  const nodes = [categoryNode("A"), categoryNode("X"), categoryNode("S"), categoryNode("B", ["A"])]
  const h = await selfResumeE2e("reprobe", nodes, { admit })
  const sStart = h.starts.hold("S")
  const run = settlement(h.scheduler.run())
  await Promise.race([h.runner.whenStarted(2), timeout("A's and X's children to start")])
  await Promise.race([sStart.reached, timeout("S's start to reach the gate")])
  const parked = whenTransition(h, "B", (event) => event.reason.kind === "residency_queued")
  denyResidency = true
  h.runner.settle("A", completed("A"))
  await Promise.race([parked, timeout("B to be parked by a residency denial")])
  denyResidency = false
  const foldX = async (): Promise<void> => {
    const folded = whenTransition(h, "X", (event) => event.to === "completed")
    h.runner.settle("X", completed("X"))
    await Promise.race([folded, timeout("X's fold")])
    await drainMicrotasks()
  }
  const teardown = async (): Promise<void> => {
    sStart.release()
    await h.scheduler.cancel(h.runId, "test teardown").catch(() => undefined)
    await Promise.race([run.outcome, timeout("the run to settle after teardown")])
  }
  return { h, run, sStart, foldX, teardown }
}

describe("a parked dependent re-probed mid-batch after its dependency re-opened (#12134 on #10057)", () => {
  test("#given B parked behind a residency denial #when A's child starts a turn on its own and a fold re-probes B #then B is not launched on A's earlier result and starts on A's resumed result", async () => {
    // given
    const { h, foldX, teardown } = await dependentParkedInOpenBatch()
    await Promise.race([h.runner.selfResume("A"), timeout("A's turn to be reopened")])
    await drainMicrotasks()
    expect(h.node("A")?.state).toBe("running")

    // when: X's fold frees a slot and re-probes the parked denials, with S's start still held
    await foldX()

    // then
    expect(startsOf(h, "B")).toBe(1)
    expect(h.node("B")?.state).toBe("pending")
    expect(transitionsOf(h, "B")).toContain("scheduled->pending:resumed")
    const bStarted = h.starts.whenCalled("B")
    h.runner.settle("A", completed("A-resumed"))
    await Promise.race([h.runner.whenStarted(3), timeout("B's child to start on A's resumed result")])
    await bStarted
    expect(startsOf(h, "B")).toBe(2)
    expect(readDagNodeResult({ store: h.fixture.store, runId: h.runId, nodeId: "A" as DagNodeId })?.output).toBe(
      "output:A-resumed",
    )
    await teardown()
  })

  test("#given B parked behind a residency denial and A re-opened #when A's resumed turn fails #then B is skipped and never launched again", async () => {
    // given
    const { h, run, sStart, foldX } = await dependentParkedInOpenBatch()
    await Promise.race([h.runner.selfResume("A"), timeout("A's turn to be reopened")])
    await foldX()

    // when
    const aFailed = whenTransition(h, "A", (event) => event.to === "failed")
    h.runner.settle("A", failed("A"))
    await Promise.race([aFailed, timeout("A's resumed failure to fold")])
    sStart.release()
    await Promise.race([h.runner.whenStarted(3), timeout("S's child to start")])
    h.runner.settle("S", completed("S"))
    await Promise.race([run.outcome, timeout("the run to settle")])

    // then
    expect(h.node("B")?.state).toBe("skipped")
    expect(startsOf(h, "B")).toBe(1)
    expect(h.scheduler.snapshot().status).toBe("failed")
  })

  test("#given B parked behind a residency denial and A not resumed #when a fold re-probes B #then B is launched inside the same batch", async () => {
    // given
    const { h, foldX, teardown } = await dependentParkedInOpenBatch()

    // when
    await foldX()
    await Promise.race([h.runner.whenStarted(3), timeout("B's child to start inside the batch")])

    // then
    expect(startsOf(h, "B")).toBe(2)
    expect(h.starts.calls).not.toContain("S")
    expect(h.node("A")?.state).toBe("completed")
    await teardown()
  })
})

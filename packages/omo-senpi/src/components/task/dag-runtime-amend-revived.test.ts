// An amend re-enters the run like a retry, so it is refused while a node revived by a send still runs,
// and goes through once that node's fold has landed (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { createDagManager, type DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { node, runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { sendRun, THIS_HOST } from "../../../../senpi-task/src/dag/__fixtures__/send-run"
import type { DagRunReentry } from "../../../../senpi-task/src/dag/scheduler"
import { createDagRuntimeControls } from "./dag-runtime-controls"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG runtime amend while a revived node runs", () => {
  test("#given node a revived #when the run is amended before a's child settles #then run_still_active naming a, and the amend works after a's fold", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a", "b"])
    const revived = await run.send("a")
    const reentries: DagRunReentry[] = []
    const controls = createDagRuntimeControls({
      coreManager: createDagManager({ store: run.base }),
      schedulerOptions: {
        store: run.base,
        taskManager: run.manager,
        hostPid: THIS_HOST,
        isProcessAlive: (pid) => pid === THIS_HOST,
        reservations: run.reservations,
      },
      schedulers: new Map(),
      reservations: run.reservations,
      holdsRun: () => false,
      sessionId: () => run.read()?.parentSessionId ?? "",
      clearAdmissionLatch: () => undefined,
      adoptReentry: (_id: DagRunId, reentry) => {
        reentries.push(reentry)
      },
    })
    const definition = { key: "send-run", name: "send run", nodes: [node("a"), { ...node("b"), prompt: "again" }] }
    const eventsBefore = run.events().length

    // when
    const refusal = await run.refusalOf(() => controls.amend(runId, definition))

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_still_active", nodeIds: ["a"] }))
    expect(run.events()).toHaveLength(eventsBefore)
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)

    // and after a's fold the amend re-enters the run
    run.manager.complete("task-a")
    await revived.settled
    await controls.amend(runId, definition)
    expect(reentries).toHaveLength(1)
    expect((await reentries[0]?.run)?.status).toBe("completed")
  })
})

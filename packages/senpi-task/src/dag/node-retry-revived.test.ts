// A re-entry (retry, amend) is eligible only while no node of the run is active, a settled run included:
// a node revived by a send keeps this host's lease until its fold, and a re-entry scheduler would not
// follow that child, park the run and drop the lease while the child runs (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { runId } from "./__fixtures__/reattached-run"
import { sendRun, THIS_HOST } from "./__fixtures__/send-run"
import { retryDagNodes } from "./node-retry"
import type { DagNodeId } from "./types"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function retryOwn(run: ReturnType<typeof sendRun>, nodeId: string) {
  const initialRecord = run.read()
  if (initialRecord === null) throw new Error("expected a checkpoint")
  return retryDagNodes(
    {
      store: run.base,
      taskManager: run.manager,
      hostPid: THIS_HOST,
      isProcessAlive: (pid) => pid === THIS_HOST,
      initialRecord,
      reservations: run.reservations,
    },
    runId,
    [nodeId as DagNodeId],
  )
}

describe("DAG re-entry while a revived node runs", () => {
  test("#given node a revived #when node b is retried before a's child settles #then run_still_active naming a, nothing written, and the retry works after a's fold", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a", "b"])
    const revived = await run.send("a")
    const eventsBefore = run.events().length

    // when
    const refusal = await run.refusalOf(() => retryOwn(run, "b"))

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_still_active", nodeIds: ["a"] }))
    expect(run.events()).toHaveLength(eventsBefore)
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)

    // and after a's child settles, its fold drops the lease and the retry of b goes through
    run.manager.complete("task-a")
    await revived.settled
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect((await retryOwn(run, "b").run).status).toBe("completed")
  })

  test("#given node a revived #when a itself is retried #then it is refused node_not_retryable as before", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a", "b"])
    const revived = await run.send("a")

    // when
    const refusal = await run.refusalOf(() => retryOwn(run, "a"))

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_retryable" }))
    run.manager.complete("task-a")
    await revived.settled
  })
})

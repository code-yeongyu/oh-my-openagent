import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import type { OwnerResumeVerdict } from "../manager/types"
import { completed } from "./__fixtures__/controlled-runner"
import { THIS_HOST, unscheduledRun, type Leased } from "./__fixtures__/stack-composition"
import { createDagOwnerResumeFence } from "./owner-resume-fence"
import type { DagFileStore } from "./store"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const OTHER_LIVE_HOST = THIS_HOST + 1
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// R6 (#11381): the record of a held trigger is written only through the one write to a user-stopped
// run, which decides the same Stop and the holder at the write. The turn's answer is the fence's,
// decided on the record it read; a write the rule refuses writes nothing and leaves that answer.
async function stoppedRunWithChangeAtTheWrite(change: (current: Leased) => Leased) {
  const run = await unscheduledRun(roots, ["A", "B"], { start: ["A"] })
  run.runner.settle("A", completed("A"))
  await run.fixture.taskManager.waitFor(run.taskOf("A"))
  run.write(
    "paused",
    { A: { state: "completed", taskId: run.taskOf("A") }, B: { state: "pending" } },
    { pause: { reason: "user_stop", pauseSeq: 1 } },
  )
  let armed = false
  const store = new Proxy(run.fixture.store, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (property !== "withRunLock" || typeof value !== "function")
        return typeof value === "function" ? value.bind(target) : value
      return (...args: Parameters<DagFileStore["withRunLock"]>) => {
        if (armed) {
          armed = false
          const current = run.read()
          if (current !== null) target.writeCheckpoint(run.runId, change(current))
        }
        return value.apply(target, args)
      }
    },
  })
  const fence = createDagOwnerResumeFence({
    store,
    heldTriggers: {
      reservations: run.reservations,
      store,
      taskManager: run.fixture.taskManager,
      hostPid: THIS_HOST,
      isProcessAlive: (pid) => pid === THIS_HOST || pid === OTHER_LIVE_HOST,
    },
  })
  const decide = (): OwnerResumeVerdict => {
    const task = run.fixture.taskStore.load(run.taskOf("A"))
    if (task === null) throw new Error("no task A")
    const verdict = fence(task)
    armed = true
    if (verdict.kind === "refuse") verdict.record?.()
    return verdict
  }
  const recorded = () => ({
    events: run.fixture.store
      .readEvents(run.runId, 0, { limit: 500 })
      .events.filter((event) => event.type === "dag.diagnostic.added").length,
    heldTrigger: run.read()?.nodes.find((node) => node.id === "A")?.heldTrigger,
  })
  return { run, decide, recorded }
}

describe("the held-trigger record follows the stopped-run write rule", () => {
  test("#given another live process takes the run between the fence's decision and the write #when the hold is recorded #then nothing is written and the turn stays held", async () => {
    // given
    const { run, decide, recorded } = await stoppedRunWithChangeAtTheWrite((current) => ({
      ...current,
      leaseHolderPid: OTHER_LIVE_HOST,
    }))

    // when
    const verdict = decide()

    // then
    expect(verdict).toMatchObject({ kind: "refuse", disposition: "hold" })
    expect(recorded()).toEqual({ events: 0, heldTrigger: undefined })
    expect(run.read()?.leaseHolderPid).toBe(OTHER_LIVE_HOST)
  })

  test("#given the user's Stop is gone between the fence's decision and the write #when the hold is recorded #then nothing is written and the turn stays held", async () => {
    // given
    const { decide, recorded } = await stoppedRunWithChangeAtTheWrite((current) => {
      const { pause: _resumed, ...rest } = current
      return { ...rest, status: "running" }
    })

    // when
    const verdict = decide()

    // then
    expect(verdict).toMatchObject({ kind: "refuse", disposition: "hold" })
    expect(recorded()).toEqual({ events: 0, heldTrigger: undefined })
  })

  test("#given the Stop is gone before the fence decides #when the child starts a turn #then the ordinary rule answers (a current claim of an active run reopens) and nothing is recorded", async () => {
    // given
    const { run, decide, recorded } = await stoppedRunWithChangeAtTheWrite((current) => current)
    const current = run.read()
    if (current === null) throw new Error("no run")
    const { pause: _resumed, ...rest } = current
    run.fixture.store.writeCheckpoint(run.runId, { ...rest, status: "running" })

    // when
    const verdict = decide()

    // then
    expect(verdict).toEqual({ kind: "allow" })
    expect(recorded()).toEqual({ events: 0, heldTrigger: undefined })
  })

  test("#given the run is still stopped by the same Stop and nobody else holds it #when the hold is recorded #then the node carries it", async () => {
    // given
    const { run, decide, recorded } = await stoppedRunWithChangeAtTheWrite((current) => current)

    // when
    decide()

    // then
    expect(recorded()).toMatchObject({ events: 1, heldTrigger: { taskId: run.taskOf("A"), count: 1 } })
  })
})

// Recovery claims a run, writes its own pid as the lease, and only then reconciles and installs the
// scheduler. Until that scheduler is registered nothing in this runtime holds the run, so whatever
// arrives in that window - a second recovery sweep, a shutdown - must wait for the installation.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { FOREIGN_HOST_PID, within } from "./dag-runtime-recovery.test-support"
import { successorSession as successorSessionIn } from "./dag-runtime-successor.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const successorSession = (
  ...args: Parameters<typeof successorSessionIn> extends [string[], ...infer Rest] ? Rest : never
) => successorSessionIn(cleanupRoots, ...args)

describe("DAG runtime while recovery is still installing a claimed run", () => {
  test("#given recovery waiting on a claimed run's admission #when the session shuts down #then the run ends paused and no scheduler starts after the pause", async () => {
    // given - the dead host left `first` scheduled, so the claim must launch its child first
    const session = await successorSession("shutdown", { killed: { first: { state: "scheduled" } } }, { alive: false })
    session.gate("killed")
    const attaching = session.runtime.attach()
    await within(session.entered, "recovery reaching the admission")

    // when
    const pausing = session.runtime.pauseForShutdown()
    session.release()
    await within(attaching, "attach")
    await within(pausing, "pauseForShutdown")

    // then
    const runEvents = session.eventTypes("killed").filter((type) => type.startsWith("dag.run."))
    expect(runEvents.at(-1)).toBe("dag.run.paused")
    expect(session.status("killed")).toBe("paused")
    session.runtime.dispose()
  })

  test("#given two leased runs whose holder exits #when both lease watches fire while one claim waits on admission #then that run is installed once", async () => {
    // given
    const holder = { alive: true }
    const session = await successorSession(
      "two-watches",
      { gated: { first: { state: "scheduled" } }, plain: { first: { state: "completed" } } },
      holder,
    )
    session.gate("gated")
    await within(session.runtime.attach(), "attach")
    expect(session.status("gated")).toBe("running")

    // when - both watches fire in one tick and each starts a whole-session sweep
    holder.alive = false
    session.timers.tick()
    await within(session.entered, "the gated claim reaching the admission")
    session.release()
    for (let started = 1; started <= 3; started += 1) {
      await within(session.runner.whenStarted(started), `child ${started} starting`)
      session.runner.handles[started - 1]?.settle(`done ${started}`)
    }
    const [gated, plain] = await Promise.all([
      within(session.runtime.wait(session.runId("gated"), session.sessionId), "the gated run settling"),
      within(session.runtime.wait(session.runId("plain"), session.sessionId), "the plain run settling"),
    ])

    // then - one installation: one resumed generation and one launch per node
    expect(gated.status).toBe("completed")
    expect(plain.status).toBe("completed")
    expect(session.eventTypes("gated").filter((type) => type === "dag.run.resumed")).toHaveLength(1)
    expect(session.startOwned.filter((entry) => entry.startsWith(session.runId("gated"))).sort()).toEqual([
      `${session.runId("gated")}:first`,
      `${session.runId("gated")}:second`,
    ])
    expect(session.runner.handles).toHaveLength(3)
    session.runtime.dispose()
  })

  test("#given a claim still installing and a run a live host holds #when the session shuts down and that host exits afterwards #then no recovery starts after the shutdown", async () => {
    // given
    const holder = { alive: true }
    const session = await successorSession(
      "shutdown-fence",
      { claimed: { first: { state: "scheduled" } }, leased: { first: { state: "completed" } } },
      holder,
      new Set(["claimed"]),
    )
    session.gate("claimed")
    const attaching = session.runtime.attach()
    await within(session.entered, "the claim reaching the admission")

    // when - the sweep finishes, and reports the leased run, only after the shutdown began
    const pausing = session.runtime.pauseForShutdown()
    session.release()
    await within(attaching, "attach")
    await within(pausing, "pauseForShutdown")
    const before = session.eventTypes("leased")

    // then - no lease watch survives the shutdown
    expect(session.timers.pending()).toBe(0)

    // and when the leased run's holder exits, no recovery of this host claims it
    holder.alive = false
    session.timers.tick()
    expect(session.lease("leased")).toBe(FOREIGN_HOST_PID)
    expect(session.eventTypes("leased")).toEqual(before)
    expect(session.status("leased")).toBe("running")
    session.runtime.dispose()
  })
})

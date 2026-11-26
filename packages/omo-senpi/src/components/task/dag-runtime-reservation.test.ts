// A recovery claim writes this host's lease before its scheduler is registered, so for that window
// nothing in the runtime "holds" the run. Every other mutation must see the installation in flight:
// a cancel waits for it and then cancels through the scheduler that now holds the run, and a
// model-driven verb is refused as busy instead of racing it (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { within } from "./dag-runtime-recovery.test-support"
import { successorSession } from "./dag-runtime-successor.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const TERMINAL_TASK_STATUSES = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

async function installingRun(name: string) {
  const session = await successorSession(
    cleanupRoots,
    name,
    { killed: { first: { state: "scheduled" } } },
    { alive: false },
    new Set(["killed"]),
  )
  session.gate("killed")
  const attaching = session.runtime.attach()
  await within(session.entered, "the claim reaching the admission")
  return { ...session, runId: session.runId("killed"), attaching }
}

describe("DAG runtime mutations while recovery installs a claimed run", () => {
  test("#given recovery still installing a claimed run #when the run is cancelled and the installation then finishes #then the run stays cancelled and its child is ended", async () => {
    // given
    const session = await installingRun("cancel")

    // when
    const cancelling = session.runtime.cancel(session.runId)
    session.release()
    await within(session.attaching, "attach")
    await within(cancelling, "runtime.cancel")

    // then - nothing resumes the run after its cancellation
    const types = session.eventTypes("killed")
    const cancelledAt = types.lastIndexOf("dag.run.cancelled")
    expect(cancelledAt).toBeGreaterThanOrEqual(0)
    expect(types.slice(cancelledAt + 1)).not.toContain("dag.run.resumed")
    expect(session.status("killed")).toBe("cancelled")

    // and the one child admitted before the cancel arrived is cancelled by the scheduler that by then
    // held the run; nothing starts after it
    expect(session.runner.handles).toHaveLength(1)
    for (const handle of session.runner.handles) {
      expect(TERMINAL_TASK_STATUSES.has(session.engine.manager.get(handle.spec.taskId)?.status ?? "")).toBe(true)
    }
    session.runtime.dispose()
  })

  test("#given recovery still installing a claimed run #when a retry arrives #then it is refused as busy, naming the installation", async () => {
    // given
    const session = await installingRun("retry")

    // when
    const refusal = await within(
      session.runtime.retry(session.runId).then(
        () => undefined,
        (error: unknown) => error,
      ),
      "runtime.retry",
    )
    session.release()
    await within(session.attaching, "attach")

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_busy", message: expect.stringContaining("recovery") }))
    session.runtime.dispose()
  })
})

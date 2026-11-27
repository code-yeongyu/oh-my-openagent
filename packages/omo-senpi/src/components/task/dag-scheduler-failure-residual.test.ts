// The accepted residual of a park whose scheduler_failed pause cannot be written (#15125): the nodes are
// failed, the lease released, the run still reads running. Verbs give usable answers on it, and the next
// session start's recovery settles it `failed` without starting a child; a further start writes nothing.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { recoveryEngine, ScriptedRunner, within } from "./dag-runtime-recovery.test-support"
import { failedSchedulerRun } from "./dag-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** The residual, reached through the handler's real second-failure park with the pause append refused. */
async function residualRun() {
  let refused = false
  const run = failedSchedulerRun(cleanupRoots, {
    wrap: (base) => ({
      ...base,
      appendEvent: (event) => {
        if (!refused && event.type === "dag.run.paused") {
          refused = true
          throw new Error("disk I/O failure")
        }
        return base.appendEvent(event)
      },
    }),
  })
  await run.fail()
  run.state.held = false
  await run.fail()
  expect(refused).toBe(true)
  expect(run.read()).toEqual(expect.objectContaining({ status: "running" }))
  expect(run.read()?.leaseHolderPid).toBeUndefined()
  expect(run.read()?.nodes.map((node) => node.state)).toEqual(["failed"])
  expect(run.logs).toContainEqual(
    expect.objectContaining({ level: "error", fields: expect.objectContaining({ runId }) }),
  )
  return run
}

/** A new session over the same project: a real runtime, a fresh engine, the same run store. */
async function sessionStart(directory: string, sessionId: string, attach = true) {
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(directory, sessionId, pi, runner)
  const runtime = createDagRuntime({
    pi,
    engine,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  })
  if (attach) await within(runtime.attach(), "attach")
  return { runtime, runner }
}

describe("DAG park whose pause could not be written", () => {
  test("#given the residual record #when the next session starts #then recovery settles it failed without a child, and a further start writes nothing", async () => {
    // given
    const run = await residualRun()
    const before = run.events().length

    // when
    const session = await sessionStart(run.directory, run.running.parentSessionId)
    const result = await within(session.runtime.wait(runId, run.running.parentSessionId), "the run settling")

    // then
    expect(
      run
        .events()
        .slice(before)
        .map((event) => event.type)
        .filter((type) => type.startsWith("dag.run.")),
    ).toEqual(["dag.run.resumed", "dag.run.failed"])
    expect(result.status).toBe("failed")
    expect(run.read()?.status).toBe("failed")
    expect(session.runner.handles).toHaveLength(0)
    session.runtime.dispose()

    // and a further session start writes nothing
    const settled = run.events().length
    const again = await sessionStart(run.directory, run.running.parentSessionId)
    expect(run.events()).toHaveLength(settled)
    again.runtime.dispose()
  })

  test("#given the residual record #when a session's verbs reach it #then retry answers run_still_active and cancel works", async () => {
    // given - the live session that hit the residual: its attach (and recovery sweep) is behind it
    const run = await residualRun()
    const verbs = await sessionStart(run.directory, run.running.parentSessionId, false)

    // when / then
    const refusal = await verbs.runtime.retry(runId).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(refusal).toEqual(expect.objectContaining({ code: "run_still_active" }))
    await within(verbs.runtime.cancel(runId), "runtime.cancel")
    expect(run.read()?.status).toBe("cancelled")
    verbs.runtime.dispose()
  })
})

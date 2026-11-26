// A scheduler of this live process ends with an error instead of settling its run (a fault while it
// follows an admitted child). The run must not stay `running` with nothing driving it until the next
// session start: the place that learns the scheduler ended hands the run to recovery, which claims a
// `running` run no scheduler here holds and follows its live children again (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { dagNode, recoveryEngine, ScriptedRunner, within } from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function failingScheduler(name: string) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-scheduler-failure-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-scheduler-failure-${name}`
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  // The first time the scheduler follows an admitted child, following it fails.
  const waitFor = engine.manager.waitFor.bind(engine.manager)
  let faulted = false
  engine.manager.waitFor = (taskId: string) => {
    if (faulted) return waitFor(taskId)
    faulted = true
    throw new Error("attachment fault")
  }
  let markFailed = (): void => undefined
  const failed = new Promise<void>((resolve) => (markFailed = resolve))
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => {
      if (message === "omo-senpi dag scheduler failed") markFailed()
    },
  }
  const runtime = createDagRuntime({ pi, engine, logger })
  await within(runtime.attach(), "attach")
  const started = await within(
    runtime.manager.start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: { key: name, name, nodes: [dagNode("only")] },
    }),
    "manager.start",
  )
  const runId = started.snapshot.runId
  await within(runner.whenStarted(1), "the child starting")
  await within(failed, "the scheduler failing")
  const store = createDagFileStore({ project_dir: cwd })
  const read = () => store.readCheckpoint<DagRunRecordV1>(runId)
  return { sessionId, runtime, runner, engine, runId, read }
}

describe("DAG runtime after a scheduler of this process fails", () => {
  test("#given the scheduler failed while its child runs #when the child settles #then this process follows it again and the run completes", async () => {
    // given
    const run = await failingScheduler("redrive")

    // when
    run.runner.handles[0]?.settle("done")
    const result = await within(run.runtime.wait(run.runId, run.sessionId), "the run settling after the failure")

    // then
    expect(result.status).toBe("completed")
    expect(run.read()?.status).toBe("completed")
    run.runtime.dispose()
  })

  test("#given the scheduler failed while its child runs #when the run is cancelled #then the run reads cancelled and its child is cancelled", async () => {
    // given
    const run = await failingScheduler("cancel")
    const taskId = run.runner.handles[0]?.spec.taskId

    // when
    await within(run.runtime.cancel(run.runId), "runtime.cancel")

    // then
    expect(run.read()?.status).toBe("cancelled")
    expect(run.engine.manager.get(taskId ?? "")?.status).toBe("cancelled")
    expect(run.read()?.nodes.some((node) => node.state === "running" || node.state === "scheduled")).toBe(false)
    run.runtime.dispose()
  })
})

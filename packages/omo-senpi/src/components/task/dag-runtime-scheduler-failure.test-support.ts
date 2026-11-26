// A live session whose DAG scheduler fails while following its admitted child: the first `faults` times
// a scheduler follows a child, the task manager answers with the child still running, which a
// scheduler treats as a processing error and rejects its run on (#15125).
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunEvent, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { dagNode, recoveryEngine, ScriptedRunner, within } from "./dag-runtime-recovery.test-support"

export async function failingScheduler(cleanupRoots: string[], name: string, faults = 1) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-scheduler-failure-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-scheduler-failure-${name}`
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  const waitFor = engine.manager.waitFor.bind(engine.manager)
  let remaining = faults
  engine.manager.waitFor = (taskId: string) => {
    const record = engine.manager.get(taskId)
    if (remaining === 0 || record === undefined) return waitFor(taskId)
    remaining -= 1
    return Promise.resolve({ ...record, status: "running" as const })
  }
  let failures = 0
  let markFailed = (): void => undefined
  const failed = new Promise<void>((resolve) => (markFailed = resolve))
  let markParked = (): void => undefined
  const parked = new Promise<void>((resolve) => (markParked = resolve))
  const logger = {
    info: () => undefined,
    warn: (message: string) => {
      if (message === "omo-senpi dag run parked after its scheduler failed again") markParked()
    },
    error: (message: string) => {
      if (message === "omo-senpi dag scheduler failed" && ++failures === faults) markFailed()
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
  await within(failed, faults === 1 ? "the scheduler failing" : "the scheduler failing again")
  const store = createDagFileStore({ project_dir: cwd })
  const read = () => store.readCheckpoint<DagRunRecordV1 & { readonly leaseHolderPid?: number }>(runId)
  const runEvents = (): readonly DagRunEvent[] =>
    store.readEvents(runId, 0, { limit: 500 }).events.filter((event) => event.type.startsWith("dag.run."))
  return { sessionId, runtime, runner, engine, runId, read, runEvents, parked }
}

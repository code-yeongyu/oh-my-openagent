// A live session whose DAG scheduler fails while following its child: each entry of `faults` answers one
// `waitFor` of a scheduler with the child still running, a processing error that rejects that
// scheduler's run, either at once ("now") or when the test calls `fail()` ("later"). `gateSend` holds
// every `sendToTask` at a gate, so a send keeps the run's reservation until `openSend()` (#15125).
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunEvent, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { dagNode, recoveryEngine, ScriptedRunner, within } from "./dag-runtime-recovery.test-support"

type Fault = "now" | "later"

function signal() {
  let fire = (): void => undefined
  const fired = new Promise<void>((resolve) => (fire = resolve))
  return { fired, fire }
}

export async function failingScheduler(
  cleanupRoots: string[],
  name: string,
  faultsOrCount: number | readonly Fault[] = 1,
  options: { readonly gateSend?: boolean } = {},
) {
  const faults: Fault[] =
    typeof faultsOrCount === "number" ? Array.from({ length: faultsOrCount }, () => "now") : [...faultsOrCount]
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-scheduler-failure-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-scheduler-failure-${name}`
  const pi = new FakeExtensionAPI()
  const runner = new ScriptedRunner()
  const engine = recoveryEngine(cwd, sessionId, pi, runner)
  const later = signal()
  const laterArmed = signal()
  const waitFor = engine.manager.waitFor.bind(engine.manager)
  engine.manager.waitFor = (taskId: string) => {
    const record = engine.manager.get(taskId)
    const fault = faults.shift()
    if (fault === undefined || record === undefined) return waitFor(taskId)
    const stillRunning = { ...record, status: "running" as const }
    if (fault === "now") return Promise.resolve(stillRunning)
    laterArmed.fire()
    return later.fired.then(() => stillRunning)
  }
  const sendEntered = signal()
  const sendGate = signal()
  if (options.gateSend === true) {
    engine.manager.sendToTask = async (input) => {
      sendEntered.fire()
      await sendGate.fired
      return { kind: "steered", task_id: input.idOrName, status: "running", delivered: "steer" }
    }
  }
  const failures: Array<ReturnType<typeof signal>> = [signal(), signal(), signal()]
  let failed = 0
  const logs: Array<{ readonly message: string; readonly fields?: unknown }> = []
  const parked = signal()
  const logger = {
    info: (message: string, fields?: unknown) => void logs.push({ message, fields }),
    warn: (message: string, fields?: unknown) => {
      logs.push({ message, fields })
      if (message === "omo-senpi dag run parked after its scheduler failed again") parked.fire()
    },
    error: (message: string, fields?: unknown) => {
      logs.push({ message, fields })
      if (message === "omo-senpi dag scheduler failed") failures[failed++]?.fire()
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
  const leadingNow = typeof faultsOrCount === "number" ? faultsOrCount : 0
  if (leadingNow > 0) await within(failures[leadingNow - 1]?.fired ?? Promise.resolve(), "the scheduler failing")
  const store = createDagFileStore({ project_dir: cwd })
  const read = () => store.readCheckpoint<DagRunRecordV1 & { readonly leaseHolderPid?: number }>(runId)
  const runEvents = (): readonly DagRunEvent[] =>
    store.readEvents(runId, 0, { limit: 500 }).events.filter((event) => event.type.startsWith("dag.run."))
  return {
    sessionId,
    runtime,
    runner,
    engine,
    runId,
    read,
    runEvents,
    logs,
    parked: parked.fired,
    failure: (n: number) => failures[n - 1]?.fired ?? Promise.resolve(),
    fail: later.fire,
    laterArmed: laterArmed.fired,
    sendEntered: sendEntered.fired,
    openSend: sendGate.fire,
  }
}

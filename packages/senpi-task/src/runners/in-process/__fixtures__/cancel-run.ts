import { createTaskLifecycle } from "../../../lifecycle/create"
import {
  cleanupProjects,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "../../../lifecycle/__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "../../../lifecycle/host-session"
import { adaptInProcessHandle } from "../../../manager/child-handle"
import { createSteeringEngine } from "../../../steering/engine"
import type { SteeringPort } from "../../../steering/types"
import { InProcessRunner } from "../../in-process"
import { createActiveTurnChild, type ActiveTurn } from "./active-turn-child"
import { createBuiltinChildMachine } from "./builtin-child"

// omo#15191, one process per case so a rejection nobody awaits cannot come from another case: a real
// in-process child whose turn is active is cancelled the way a workflow cancel does it (the steering
// cancel with the abort skipped, torn down through the lifecycle). The result is written when the
// event loop has drained, so anything the teardown left floating is in it.
const turn: ActiveTurn = process.argv[2] === "runs-a-tool" ? "runs-a-tool" : "holds"
const TASK = "st_00015191"
const STILL_RUNNING_AFTER_MS = 5_000

const floating: string[] = []
process.on("unhandledRejection", (reason) => floating.push(String(reason)))
process.on("uncaughtException", (error) => floating.push(String(error)))

const machine = await createBuiltinChildMachine()
const active = createActiveTurnChild(machine, TASK, turn)
const child = adaptInProcessHandle(await new InProcessRunner(active.runnerOptions).start(active.spec))
const store = tempStore()
const registry = new FakeRegistry()
registry.add({
  task_id: TASK,
  kind: "in-process",
  pid: undefined,
  abort: () => child.abort(),
  dispose: () => child.dispose(),
  terminate: async () => {},
})
seedRecord(store, { task_id: TASK, status: "running", residency_state: "resident", host_pid: process.pid })
const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config: settings() })
const destroyed: string[] = []
const port: SteeringPort = {
  store,
  liveHandle: (taskId) => (registry.get(taskId) === undefined ? undefined : child),
  reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
  reviveDetached: async () => ({ ok: false, reason: "not used" }),
  dequeuePending: () => false,
  destruction: {
    destroyResidentTask: async (taskId, cause) => {
      destroyed.push(cause)
      await lifecycle.destroyResidentTask(taskId, cause)
    },
  },
  runStatsSnapshot: () => undefined,
  now: () => Date.now(),
}

await active.whenActive
const before = active.observed()
const cancel = await createSteeringEngine(port).cancelTask(TASK, "stop the run", { abort: "skip" })
let stillRunning: ReturnType<typeof setTimeout> | undefined
const turnEnd = await Promise.race([
  child.waitForOutcome().then((outcome) => outcome.status),
  new Promise<"still running">((resolve) => {
    stillRunning = setTimeout(() => resolve("still running"), STILL_RUNNING_AFTER_MS)
  }),
])
clearTimeout(stillRunning)
const record = store.load(TASK)
const after = active.observed()
const result = {
  cancel: cancel.kind,
  destroyed: [...destroyed],
  turn: turnEnd,
  record: record?.status,
  residency: record?.residency_state,
  providerCallsAfterCancel: after.providerCalls - before.providerCalls,
  ...(turn === "holds" ? { providerAborted: after.providerAborted } : { tool: after.tool }),
}
if (turnEnd === "still running") {
  await child.abort()
  await child.dispose()
}
lifecycle.dispose?.()
cleanupProjects()
machine.cleanup()
process.once("beforeExit", () => {
  process.stdout.write(`${JSON.stringify({ ...result, floating })}\n`)
})

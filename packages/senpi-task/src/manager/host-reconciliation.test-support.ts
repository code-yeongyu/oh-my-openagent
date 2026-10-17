import { appendFileSync } from "node:fs"

import { childSpec, hostRunnerHarness } from "../runners/rpc-host.test-support"
import { isHostSessionHandle } from "../runners/rpc-host"
import type { InputEffectStatus } from "../runners/rpc-host/reconcile-turn"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { makeManager, tempProject } from "./__fixtures__/manager-fakes"
import { respawnManagedTask } from "./manager-respawn"

export const reconciliationHarness = hostRunnerHarness()

/** The receipt lands in the session transcript exactly as senpi writes it; everything else crosses the real wire. */
export async function stoppedChild(receipt: InputEffectStatus) {
  const project = tempProject()
  const host = await reconciliationHarness.fakeHost({ transcripts: true })
  const runner = reconciliationHarness.runnerOver(host)
  const initial = createTaskRecord({
    parent_session_id: "parent", root_session_id: "parent", depth: 1,
    execution_mode: "process", model: "anthropic/claude-sonnet-4-5", notify_on_terminal: false,
  }, 0)
  // Production wiring (manager/runner.ts, manager-respawn.ts): the task record exists in the task store before the
  // first input, so input ids come from its persisted effect_seq and the respawned continuation gets the next one.
  const inputStore = createTaskRecordStore({ project_dir: project, task: { state_dir: project } })
  inputStore.save({ ...initial, status: "running", runner_kind: "host-session" })
  const spec = childSpec({ state_dir: project, task_id: initial.task_id, cwd: project, taskStoreDir: project })
  const first = await runner.start(spec)
  if (!isHostSessionHandle(first)) throw new Error("expected host session")
  const session = first.hostSession
  const detached = host.waitForConnections(0)
  await first.dispose()
  await detached
  host.completeTurn(session.routingId, "PARTIAL TEXT")
  const sent = inputStore.load(initial.task_id)
  if (sent?.last_effect_id === undefined) throw new Error("the first input carried no effect id")
  appendFileSync(session.sessionPath, `${JSON.stringify(admissionEntry(sent.last_effect_id, receipt))}\n`)
  const record = {
    ...initial, status: "running" as const, host_pid: process.pid, runner_kind: "host-session" as const,
    spawn_spec: { version: 1 as const, cwd: project, prompt: spec.prompt },
    host_session: { socket: host.socketPath, routing_id: session.routingId, session_path: session.sessionPath, instance_id: session.instanceId },
  }
  const baseStore = createTaskRecordStore({ project_dir: project })
  const resumed = Promise.withResolvers<void>()
  const events: string[] = []
  const store = {
    ...baseStore,
    appendEvent: (taskId: string, event: Parameters<typeof baseStore.appendEvent>[1]) => {
      events.push(event.type)
      const path = baseStore.appendEvent(taskId, event)
      if (event.type === "task_self_resumed") resumed.resolve()
      return path
    },
  }
  store.save(record)
  const { manager } = makeManager({ project, store })
  const result = await respawnManagedTask({
    beforeLaunch: () => undefined, record, sessionPath: session.sessionPath, stateDir: project,
    runners: { "in-process": { start: async () => { throw new Error("unused") } }, process: { start: async () => { throw new Error("unused") } } },
    rpcRunner: runner,
  })
  if (!result.ok) throw new Error(result.reason)
  const startContinuation = (): void => {
    const active = host.sessions()[0]
    if (active === undefined) throw new Error("missing continued session")
    host.emitRecord(active.routingId, { type: "agent_start" })
  }
  return { host, result, record, manager, store, events, startContinuation, resumed: resumed.promise }
}

/** senpi's `rpc_client_message_admission` entry for one input receipt (admission states map queued/running/completed). */
function admissionEntry(clientMessageId: string, receipt: InputEffectStatus): Record<string, unknown> {
  const base = { clientMessageId, durableSessionId: "durable", fingerprint: "fp", disposition: "started" }
  const data = receipt.state === "accepted"
    ? { ...base, state: "queued", prepared: { clientMessageId, text: "queued input", mode: "steer", enqueueOrder: 1 } }
    : receipt.state === "applied"
      ? { ...base, state: "running" }
      : { ...base, state: "completed", outcome: receipt.state === "failed" ? { kind: "dropped_by_replace" } : receipt.outcome ?? { kind: "completed" } }
  return { type: "custom", customType: "rpc_client_message_admission", id: `admission-${clientMessageId}`, data }
}

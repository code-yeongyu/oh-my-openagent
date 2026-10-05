import { afterEach, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import { hostLifecycleDeps } from "../lifecycle/__fixtures__/host-session-fakes"
import { hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { adaptRpcHandle, type ManagedChildHandle } from "./child-handle"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedRunner } from "./types"

// The parent dies after the handoff is committed but before the failed rung's daemon session closed.
// Revival must close that retained session before it opens the next rung, on the real daemon wire.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function rung(id: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: id, display: `test/${id}` }
}

test("#given the parent dies before the failed rung's session closes #when another session revives the handoff #then the retained session is closed and only the next rung stays open", async () => {
  // given
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const host = await harness.fakeHost({ transcripts: true })
  const rpc = harness.runnerOver(host)
  const closing = Promise.withResolvers<void>()
  let failedRung: ManagedChildHandle | undefined
  const runner: ManagedRunner = {
    start: async (spec) => {
      failedRung = adaptRpcHandle(await rpc.start({ task_id: spec.taskId, cwd: project, state_dir: spec.stateDir, prompt: spec.prompt, model: spec.model }))
      return failedRung
    },
  }
  const owner = createTaskManager({
    store,
    config: settings(),
    cwd: project,
    hostPid: 11_001,
    runners: { process: runner, "in-process": runner },
    planner: () => ({ kind: "resolved", plan: { model: "test/first", resolved_model: rung("first"), fallback_models: [rung("next")] } }),
    destruction: { destroyResidentTask: () => { closing.resolve(); return new Promise<void>(() => undefined) } },
  })
  const task = await owner.start(baseSpec({ execution_mode: "process" }))
  if (task.kind !== "started") throw new Error("expected the task to start")
  const [original] = host.sessions()
  if (original === undefined) throw new Error("expected the failed rung's session")
  const message = { role: "assistant", content: [], stopReason: "error", errorMessage: "500 overloaded" }
  host.emitRecord(original.routingId, { type: "message_end", message })
  host.emitRecord(original.routingId, { type: "agent_end", willRetry: false, messages: [message] })
  host.emitRecord(original.routingId, { type: "agent_idle" })
  await closing.promise
  const disconnected = host.waitForConnections(0)
  await failedRung?.dispose()
  await disconnected
  owner.forget(task.task_id)
  owner.workpools.dispose()
  const sweeper = createTaskManager({
    store,
    config: settings(),
    cwd: project,
    hostPid: 22_002,
    runners: { process: new FakeRunner(), "in-process": new FakeRunner() },
    planner: () => ({ kind: "resolved", plan: { model: "test/next" } }),
    rpcRespawnRunner: rpc,
  })
  const { hostSessionProbe: _fakeProbe, hostSessionClose: _fakeClose, ...deps } = hostLifecycleDeps({ store, hostPid: 22_002, isAlive: (pid) => pid === 22_002 }).deps
  const lifecycle = createTaskLifecycle({
    ...deps,
    registry: createManagerResidencyRegistry(() => sweeper),
    respawn: (record, sessionPath) => sweeper.respawn(record, sessionPath),
    reattach: (record, handle) => sweeper.reattach(record, handle),
  })

  try {
    // when
    const result = await lifecycle.reconcileOnSessionStart("another-session")

    // then
    expect(result.outcomes).toContainEqual({ task_id: task.task_id, kind: "resumed", reason: "respawned and reattached" })
    expect(host.sessions().map((session) => session.sessionPath)).not.toContain(original.sessionPath)
    expect(host.sessions()).toHaveLength(1)
    expect(store.load(task.task_id)?.fallback_closing_child).toBeUndefined()
  } finally {
    await sweeper.getResidentHandle(task.task_id)?.dispose()
    sweeper.forget(task.task_id)
    sweeper.workpools.dispose()
    lifecycle.dispose?.()
  }
})

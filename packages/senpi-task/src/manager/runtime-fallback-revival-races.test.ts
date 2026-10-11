import { afterEach, describe, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import { hostLifecycleDeps } from "../lifecycle/__fixtures__/host-session-fakes"
import { defaultHostSessionCloser } from "../lifecycle/host-session-default"
import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedStartSpec } from "./types"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"

// Two revivals race the runtime-fallback close from the lifecycle side, where steering's closing fence
// does not reach: a session reload that revives the task, and a cancel that lands while a dead owner's
// handoff is being recovered.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function rung(id: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: id, display: `test/${id}` }
}

class FirstCloseHeld extends FakeRunner {
  readonly closing = Promise.withResolvers<void>()
  readonly finishClose = Promise.withResolvers<void>()
  closeFailure: Error | undefined
  #starts = 0

  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    let heldClose = this.#starts === 0
    this.#starts += 1
    return Object.assign(handle, {
      kind: "in-process" as const,
      dispose: async () => {
        if (!heldClose) return
        heldClose = false
        this.closing.resolve()
        await this.finishClose.promise
        if (this.closeFailure !== undefined) throw this.closeFailure
      },
    })
  }
}

describe("lifecycle revivals racing the runtime-fallback close", () => {
  for (const close of ["resolves", "rejects"] as const) {
    test(`#given a reload revives the task while its failed rung is closing #when that close later ${close} #then the revived run keeps its handle and finishes`, async () => {
      // given
      const project = tempProject()
      const store = createTaskRecordStore({ project_dir: project })
      const runner = new FirstCloseHeld()
      if (close === "rejects") runner.closeFailure = new Error("late close rejected")
      const config = settings({ default_concurrency: 2, global_concurrency: 2 })
      const concurrency = new TaskConcurrency(config)
      const manager = createTaskManager({
        store,
        config,
        concurrency,
        cwd: project,
        hostPid: 11_001,
        runners: { process: runner, "in-process": runner },
        planner: () => ({ kind: "resolved", plan: { model: "test/first", resolved_model: rung("first"), fallback_models: [rung("next")] } }),
        destruction: { destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause) },
      })
      const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, config, hostPid: 11_001, registry: createManagerResidencyRegistry(() => manager), signaller: { isAlive: (pid) => pid === 11_001, signal: () => undefined } })
      const task = await manager.start(baseSpec())
      if (task.kind !== "started") throw new Error("expected the task to start")
      const first = runner.handles.get(task.task_id)
      if (first === undefined) throw new Error("expected the first rung's handle")
      const oldLeaseReturned = Promise.withResolvers<void>()
      const releaseLease = concurrency.releaseLease.bind(concurrency)
      concurrency.releaseLease = (taskId: string, runEpoch: number) => {
        releaseLease(taskId, runEpoch)
        if (taskId === task.task_id && runEpoch === 0) oldLeaseReturned.resolve()
      }

      try {
        // when
        first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
        await runner.closing.promise
        await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "reload" })
        await lifecycle.reconcileOnSessionStart("parent-1")
        const revived = manager.getResidentHandle(task.task_id)
        const revivedControl = runner.handles.get(task.task_id)
        runner.finishClose.resolve()
        await oldLeaseReturned.promise
        const done = manager.waitFor(task.task_id, { signal: AbortSignal.timeout(5_000) })
        revivedControl?.settle({ status: "completed", finalResponse: "revived run result" })

        // then
        expect(revived).toBeDefined()
        expect(revived).not.toBe(first.handle)
        expect(manager.getResidentHandle(task.task_id)).toBe(revived)
        expect((await done).final_response).toBe("revived run result")
        expect(concurrency.leaseState(task.task_id, 2)).toBeUndefined()
      } finally {
        runner.finishClose.resolve()
        manager.forget(task.task_id, { path: "end" })
        manager.workpools.dispose()
        lifecycle.dispose?.()
      }
    })
  }

  for (const scope of [undefined, "parent-1"] as const) {
    test(`#given a dead owner's handoff is being recovered by ${scope === undefined ? "the global" : "the parent's"} reconcile #when the task is cancelled while the failed rung closes #then no replacement prompt is sent`, async () => {
      // given
      const project = tempProject()
      const store = createTaskRecordStore({ project_dir: project })
      const host = await harness.fakeHost({ transcripts: true })
      const rpc = harness.runnerOver(host)
      const taskId = scope === undefined ? "st_0000d001" : "st_0000d002"
      const old = await rpc.start({ task_id: taskId, cwd: project, state_dir: store.stateDir, prompt: "original work", model: "test/first" })
      const [original] = host.sessions()
      if (original === undefined) throw new Error("expected the failed rung's session")
      const disconnected = host.waitForConnections(0)
      await old.dispose()
      await disconnected
      seedRecord(store, { task_id: taskId, status: "running", execution_mode: "process", host_pid: 11_001, run_epoch: 1, spawn_spec: { version: 1, cwd: project, prompt: "original work" } })
      store.mutate(taskId, (record) => ({ ...record, model: "test/next", fallback_handoff_epoch: 1, fallback_closing_child: { host_session: { socket: host.socketPath, routing_id: original.routingId, session_path: original.sessionPath, instance_id: host.instanceId } } }))
      const closeEntered = Promise.withResolvers<void>()
      const releaseClose = Promise.withResolvers<void>()
      const manager = createTaskManager({
        store,
        config: settings(),
        cwd: project,
        hostPid: 22_002,
        runners: { process: new FakeRunner(), "in-process": new FakeRunner() },
        rpcRespawnRunner: rpc,
        planner: () => ({ kind: "resolved", plan: { model: "test/next" } }),
        destruction: { destroyResidentTask: (id, cause) => lifecycle.destroyResidentTask(id, cause) },
      })
      const { hostSessionProbe: _fakeProbe, hostSessionClose: _fakeClose, ...deps } = hostLifecycleDeps({ store, hostPid: 22_002, isAlive: (pid) => pid === 22_002 }).deps
      const lifecycle = createTaskLifecycle({
        ...deps,
        registry: createManagerResidencyRegistry(() => manager),
        respawn: (record, sessionPath) => manager.respawn(record, sessionPath),
        reattach: (record, handle) => manager.reattach(record, handle),
        hostSessionClose: async (request) => {
          closeEntered.resolve()
          await releaseClose.promise
          await defaultHostSessionCloser(request)
        },
      })
      const promptsBefore = host.commands.filter((command) => command.type === "prompt").length

      try {
        // when
        const recovering = lifecycle.reconcileOnSessionStart(scope)
        await closeEntered.promise
        const cancelled = await manager.cancelTask(taskId)
        releaseClose.resolve()
        await recovering

        // then
        expect(cancelled.kind).toBe("cancelled")
        expect(host.commands.filter((command) => command.type === "prompt")).toHaveLength(promptsBefore)
        expect(store.load(taskId)?.status).toBe("cancelled")
      } finally {
        releaseClose.resolve()
        await manager.getResidentHandle(taskId)?.dispose()
        manager.forget(taskId, { path: "end" })
        manager.workpools.dispose()
        lifecycle.dispose?.()
      }
    })
  }
})

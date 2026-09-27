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

// Two generations of one task coexist while runtime fallback finishes closing an old rung: a revived
// newer run, or a second revival racing the first. Each generation owns only its own lease, handle and
// claim, whichever finishes first.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function rung(id: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: id, display: `test/${id}` }
}

class OldCloseHeld extends FakeRunner {
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

describe("generations of one task during a runtime-fallback close", () => {
  for (const close of ["resolves", "rejects"] as const) {
    for (const ending of ["completes", "is interrupted", "is cancelled"] as const) {
      test(`#given a reload revived the task while its old rung closes #when the newer run ${ending} before the old close ${close} #then no lease of either run is left held`, async () => {
        // given
        const project = tempProject()
        const store = createTaskRecordStore({ project_dir: project })
        const runner = new OldCloseHeld()
        if (close === "rejects") runner.closeFailure = new Error("old close rejected")
        const config = settings({ default_concurrency: 2, global_concurrency: 2 })
        const concurrency = new TaskConcurrency(config)
        const manager = createTaskManager({
          store,
          config,
          concurrency,
          cwd: project,
          hostPid: 11_001,
          runners: { process: runner, "in-process": runner },
          planner: (spec) => ({ kind: "resolved", plan: spec.name === undefined || spec.name === "fallback" ? { model: "test/first", resolved_model: rung("first"), fallback_models: [rung("next")] } : { model: "test/first" } }),
          destruction: { destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause) },
        })
        const lifecycle = createTaskLifecycle({ store, config, hostPid: 11_001, registry: createManagerResidencyRegistry(() => manager), signaller: { isAlive: (pid) => pid === 11_001, signal: () => undefined } })
        const task = await manager.start(baseSpec({ name: "fallback" }))
        if (task.kind !== "started") throw new Error("expected the task to start")
        runner.handles.get(task.task_id)?.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
        await runner.closing.promise
        await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "reload" })
        await lifecycle.reconcileOnSessionStart("parent-1")
        const newer = runner.handles.get(task.task_id)
        if (newer === undefined) throw new Error("expected the revived run")
        let newerAborts = 0
        const abortNewer = newer.handle.abort.bind(newer.handle)
        Object.assign(newer.handle, { abort: async () => { newerAborts += 1; await abortNewer() } })

        try {
          // when
          if (ending === "completes") {
            const done = manager.waitFor(task.task_id, { signal: AbortSignal.timeout(5_000) })
            newer.settle({ status: "completed", finalResponse: "newer result" })
            await done
          } else if (ending === "is interrupted") {
            expect((await manager.interruptTask(task.task_id)).kind).toBe("interrupted")
          } else {
            expect((await manager.cancelTask(task.task_id)).kind).toBe("cancelled")
          }
          const retired = manager.residencyChanged("parent-1")
          runner.finishClose.resolve()
          await retired
          const followingOne = await manager.start(baseSpec({ name: "following-one" }))
          const followingTwo = await manager.start(baseSpec({ name: "following-two" }))

          // then
          expect([0, 1, 2].map((epoch) => concurrency.leaseState(task.task_id, epoch))).toEqual([undefined, undefined, undefined])
          expect(followingOne.kind).toBe("started")
          expect(followingTwo.kind).toBe("started")
          if (ending !== "completes") expect(newerAborts).toBeGreaterThan(0)
        } finally {
          runner.finishClose.resolve()
          manager.workpools.dispose()
          lifecycle.dispose?.()
          for (const id of manager.residentTaskIds()) manager.forget(id)
        }
      })
    }
  }

  test("#given two revivals of one handoff #when the first loses its claim to the second after the closing-child cleanup #then its rollback leaves the second's run in place", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const host = await harness.fakeHost({ transcripts: true })
    const rpc = harness.runnerOver(host)
    const taskId = "st_0000e001"
    const old = await rpc.start({ task_id: taskId, cwd: project, state_dir: store.stateDir, prompt: "original work", model: "test/first" })
    const [original] = host.sessions()
    if (original === undefined) throw new Error("expected the failed rung's session")
    const disconnected = host.waitForConnections(0)
    await old.dispose()
    await disconnected
    seedRecord(store, { task_id: taskId, status: "running", execution_mode: "process", residency_state: "rpc_detached", run_epoch: 1, spawn_spec: { version: 1, cwd: project, prompt: "original work" } })
    store.mutate(taskId, (record) => ({ ...record, fallback_handoff_epoch: 1, fallback_closing_child: { host_session: { socket: host.socketPath, routing_id: original.routingId, session_path: original.sessionPath, instance_id: host.instanceId } } }))
    const closeEntered = Promise.withResolvers<void>()
    const finishClose = Promise.withResolvers<void>()
    let closes = 0
    const manager = createTaskManager({
      store,
      config: settings(),
      cwd: project,
      hostPid: 22_002,
      runners: { process: new FakeRunner(), "in-process": new FakeRunner() },
      rpcRespawnRunner: rpc,
      planner: () => ({ kind: "resolved", plan: { model: "test/next" } }),
    })
    const { hostSessionProbe: _fakeProbe, hostSessionClose: _fakeClose, ...deps } = hostLifecycleDeps({ store, hostPid: 22_002, isAlive: (pid) => pid === 22_002 }).deps
    const lifecycle = createTaskLifecycle({
      ...deps,
      registry: createManagerResidencyRegistry(() => manager),
      respawn: (record, sessionPath) => manager.respawn(record, sessionPath),
      reattach: (record, handle) => manager.reattach(record, handle),
      hostSessionClose: async (request) => {
        closes += 1
        if (closes === 1) {
          closeEntered.resolve()
          await finishClose.promise
        }
        await defaultHostSessionCloser(request)
      },
    })

    try {
      // when
      const losing = lifecycle.reconcileOnSessionStart("parent-1")
      await closeEntered.promise
      await lifecycle.reconcileOnSessionStart("parent-1")
      finishClose.resolve()
      await losing

      // then
      expect(store.load(taskId)).toMatchObject({ host_pid: 22_002, residency_state: "resident", notification: { run_epoch: 2 } })
      expect(manager.getResidentHandle(taskId)).toBeDefined()
    } finally {
      finishClose.resolve()
      await manager.getResidentHandle(taskId)?.dispose()
      manager.forget(taskId)
      manager.workpools.dispose()
      lifecycle.dispose?.()
    }
  })
})

import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "../lifecycle/create"
import { hostLifecycleDeps } from "../lifecycle/__fixtures__/host-session-fakes"
import type { ManagedChildHandle } from "./child-handle"
import type { ManagedStartSpec, ResolvedChildPlan } from "./types"
import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskRecordStore } from "../store"
import { baseSpec, cleanupProjects, FakeRunner, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

const FIRST = "opencode-go/minimax-m3"
const NEXT = "opencode-go/minimax-m2.7"

function sessionFor(taskId: string, model: string) {
  return {
    socket: "/tmp/dh-fake/rpc.sock",
    routingId: `routing-${model}`,
    sessionPath: `/tmp/dh-fake/sessions/${taskId}-${model.replace("/", "_")}.jsonl`,
    instanceId: "instance-1",
  }
}

/** A daemon runner: every child it starts is a session with its own path, like `runners/rpc-host.ts`. */
class HostSessionRunner extends FakeRunner {
  readonly nextRungStarted = Promise.withResolvers<void>()
  watchedTaskId: string | undefined

  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    const sessioned = Object.assign(handle, { kind: "host-session" as const, hostSession: sessionFor(spec.taskId, spec.model ?? "") })
    // The manager stamps spawn facts after it subscribes, so resolve on the subscription.
    if (spec.model === NEXT && spec.taskId === this.watchedTaskId) void this.handles.get(spec.taskId)?.waitForSubscription().then(() => this.nextRungStarted.resolve())
    return sessioned
  }
}

const OWNER_PID = 11_001

/** The failed rung's daemon session closes slowly: its teardown parks until the test releases it. */
class SlowCloseRunner extends HostSessionRunner {
  readonly closing = Promise.withResolvers<void>()
  readonly finishClose = Promise.withResolvers<void>()

  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    if (spec.model !== FIRST) return handle
    return Object.assign(handle, {
      dispose: async () => {
        this.closing.resolve()
        await this.finishClose.promise
      },
    })
  }
}

function plan(): ResolvedChildPlan {
  return {
    model: FIRST,
    requested_model: { source: "category", provider: "opencode-go", model_id: "minimax-m3", display: FIRST },
    resolved_model: { source: "category", provider: "opencode-go", model_id: "minimax-m3", display: FIRST },
    fallback_models: [{ source: "category", provider: "opencode-go", model_id: "minimax-m2.7", display: NEXT }],
  }
}

// The 2026-09-26 hang: between the failed rung's session closing and the next rung's session
// opening, the record still named the CLOSED session. The next rung's child session reconciles the
// shared records from inside the daemon, took the closed session for an orphan, and stole the task.
describe("runtime fallback of a daemon-session child", () => {
  test("#given the next rung waits for capacity #when the first rung's turn fails #then the record no longer names the closed session", async () => {
    const runner = new HostSessionRunner()
    const { manager, store } = makeManager({
      inProcess: runner,
      planner: (spec) => (spec.name === "holder" ? { kind: "resolved", plan: { model: NEXT } } : { kind: "resolved", plan: plan() }),
      config: settings({ default_concurrency: 1, global_concurrency: 2, max_depth: 1 }),
    })
    const holder = await manager.start(baseSpec({ name: "holder" }))
    const task = await manager.start(baseSpec({ name: "fallback" }))
    if (holder.kind !== "started" || task.kind !== "started") throw new Error("expected tasks")
    runner.watchedTaskId = task.task_id
    expect(store.load(task.task_id)?.host_session?.session_path).toBe(sessionFor(task.task_id, FIRST).sessionPath)

    const handed = runner.handles.get(task.task_id)
    if (handed === undefined) throw new Error("expected the first rung's handle")
    const unsubscribed = handed.waitForUnsubscription()
    handed.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
    await unsubscribed

    const between = store.load(task.task_id)
    expect(between?.model).toBe(NEXT)
    expect(between?.host_session).toBeUndefined()
    expect(between?.runner_kind).toBeUndefined()
    expect(between?.pid).toBeUndefined()
    expect(between?.fallback_handoff_epoch).toBe(between?.notification.run_epoch)

    // What the next rung's child session does from inside the daemon: reconcile the shared records
    // under its own session id, in its own process, while this parent (host_pid) is alive and the
    // daemon no longer lists the closed rung's session.
    const recorded = store.load(task.task_id)
    if (recorded?.host_pid === undefined) throw new Error("expected the parent's host_pid on the record")
    const parentPid = recorded.host_pid
    const daemonSide = hostLifecycleDeps({ store, hostPid: parentPid + 1, isAlive: (pid) => pid === parentPid })
    // The holder's session is still running on the daemon; only the fallback task's rung was closed.
    daemonSide.daemon.hold(sessionFor(holder.task_id, NEXT).sessionPath)
    const sweep = await createTaskLifecycle(daemonSide.deps).reconcileOnSessionStart("next-rung-child-session")
    expect(sweep.outcomes).toContainEqual({ task_id: task.task_id, kind: "deferred", reason: "foreign_live_owner" })
    expect(daemonSide.respawned.filter((entry) => entry.task_id === task.task_id)).toEqual([])
    expect(store.load(task.task_id)?.notification.run_epoch).toBe(between?.notification.run_epoch)

    expect((await manager.cancelTask(holder.task_id)).kind).toBe("cancelled")
    await runner.nextRungStarted.promise
    expect(store.load(task.task_id)?.host_session?.session_path).toBe(sessionFor(task.task_id, NEXT).sessionPath)
    expect(store.load(task.task_id)?.fallback_handoff_epoch).toBeUndefined()
  })

  test("#given the failed rung's session is still closing #when a daemon-side session reconciles #then the live parent keeps its task and only the next rung's result lands", async () => {
    // given
    const runner = new SlowCloseRunner()
    const store = createTaskRecordStore({ project_dir: tempProject() })
    const config = settings({ default_execution_mode: "process" })
    const owner = createTaskManager({
      store,
      config,
      cwd: "/tmp",
      hostPid: OWNER_PID,
      runners: { process: runner, "in-process": runner },
      planner: () => ({ kind: "resolved", plan: plan() }),
      destruction: { destroyResidentTask: (taskId, cause) => ownerLifecycle.destroyResidentTask(taskId, cause) },
    })
    const ownerLifecycle = createTaskLifecycle({ store, config, hostPid: OWNER_PID, registry: createManagerResidencyRegistry(() => owner) })
    const daemonSide = hostLifecycleDeps({ store, hostPid: OWNER_PID + 1, isAlive: (pid) => pid === OWNER_PID })
    const task = await owner.start(baseSpec({ execution_mode: "process" }))
    if (task.kind !== "started") throw new Error("expected the task to start")
    runner.watchedTaskId = task.task_id
    const finished = owner.waitFor(task.task_id, { signal: AbortSignal.timeout(5_000) })

    try {
      // when: the first rung fails and, while the daemon is still closing its session, the next
      // rung's child session reconciles the shared records from inside the daemon
      runner.handles.get(task.task_id)?.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      await runner.closing.promise
      const closing = store.load(task.task_id)
      const sweep = await createTaskLifecycle(daemonSide.deps).reconcileOnSessionStart("next-rung-child-session")
      runner.finishClose.resolve()
      await runner.nextRungStarted.promise
      runner.handles.get(task.task_id)?.settle({ status: "completed", finalResponse: "NEXT RUNG RESULT" })

      // then
      expect(closing).toMatchObject({ model: NEXT, host_pid: OWNER_PID, fallback_handoff_epoch: 1, notification: { run_epoch: 1 } })
      expect(closing?.host_session).toBeUndefined()
      expect(sweep.outcomes).toContainEqual({ task_id: task.task_id, kind: "deferred", reason: "foreign_live_owner" })
      expect(daemonSide.respawned).toEqual([])
      expect((await finished).final_response).toBe("NEXT RUNG RESULT")
    } finally {
      runner.finishClose.resolve()
      ownerLifecycle.dispose?.()
      owner.workpools.dispose()
      owner.forget(task.task_id)
    }
  })
})

import { afterEach, describe, expect, spyOn, test } from "bun:test"

import type { ManagedChildHandle } from "./child-handle"
import type { ManagedStartSpec } from "./types"
import { RunnerError } from "../runners/in-process/runner-error"
import { bounded } from "../lifecycle/__fixtures__/live-parent-clock"
import { FakeRegistry, readEvents } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskLifecycle } from "../lifecycle"
import { hostLifecycleDeps } from "../lifecycle/__fixtures__/host-session-fakes"
import { isRevivalCandidate } from "../lifecycle/revival-selection"
import { FakeRunner, baseSpec, cleanupProjects, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

class BusyHostRunner extends FakeRunner {
  readonly release = Promise.withResolvers<unknown>()
  readonly admitted = Promise.withResolvers<string>()

  override start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    return this.release.promise.then(async (refusal) => {
      if (refusal !== undefined) throw refusal
      const handle = await super.start(spec)
      this.admitted.resolve(spec.taskId)
      return handle
    })
  }
}

// The first start is admitted at once and holds the only lane; every later start waits on the host.
class LaneThenBusyRunner extends FakeRunner {
  readonly release = Promise.withResolvers<void>()
  readonly heldStart = Promise.withResolvers<string>()
  #starts = 0

  override start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.#starts += 1
    if (this.#starts === 1) return super.start(spec)
    this.heldStart.resolve(spec.taskId)
    return this.release.promise.then(() => super.start(spec))
  }
}

// The resumed session's own registry: it owns its parent session's records, as the live engine does.
class SessionOwningRegistry extends FakeRegistry {
  readonly #parentSessionId: string

  constructor(parentSessionId: string) {
    super()
    this.#parentSessionId = parentSessionId
  }

  ownsRecord(record: { readonly parent_session_id: string }): boolean {
    return record.parent_session_id === this.#parentSessionId
  }
}

const oneLane = () => settings({ default_concurrency: 1, global_concurrency: 0 })

const hostBusy = () => new RunnerError({
  kind: "host_unavailable",
  reason: "host_busy",
  message: "the task host accepts connections but its event loop is not answering",
})

describe("task start against a busy host (#10042)", () => {
  for (const runInBackground of [true, false]) {
    test(`#given a host that does not answer #when a ${runInBackground ? "background" : "foreground"} task starts #then start returns a starting task instead of waiting for the host`, async () => {
      // given
      const held = new BusyHostRunner()
      const h = makeManager({ inProcess: held })

      // when
      const started = await bounded(h.manager.start(baseSpec({ run_in_background: runInBackground })))

      // then
      if (started.kind !== "started") throw new Error(`expected started, got ${started.kind}`)
      expect(started.starting).toBe(true)
      expect(h.store.load(started.task_id)?.status).toBe("running")
      held.release.resolve(undefined)
    })
  }

  test("#given a start still waiting on the host #when the host refuses it #then the record fails with the host's reason and waiters settle", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held, config: oneLane() })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    const failed = Promise.withResolvers<void>()
    const append = h.store.appendEvent.bind(h.store)
    spyOn(h.store, "appendEvent").mockImplementation((id, event) => {
      const result = append(id, event)
      if (id === started.task_id && event.type === "task_start_failed") failed.resolve()
      return result
    })
    const waited = h.manager.waitFor(started.task_id)

    // when
    held.release.resolve(hostBusy())
    await bounded(failed.promise)

    // then
    const record = await bounded(waited)
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("host_unavailable")
    // The same host refuses the next start too: reaching the runner at all (not a queue) proves the
    // failed start gave its lane slot back.
    const next = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    expect(next.kind).toBe("start_failed")
  })

  test("#given a start still waiting on the host #when the host admits it late #then the child runs and completes normally", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    const waited = h.manager.waitFor(started.task_id)

    // when
    held.release.resolve(undefined)
    await bounded(held.admitted.promise)
    const handle = held.handles.get(started.task_id)
    if (handle === undefined) throw new Error("admitted child has no handle")
    await bounded(handle.waitForSubscription())
    handle.settle({ status: "completed", finalResponse: "DONE" })

    // then
    const record = await bounded(waited)
    expect(record.status).toBe("completed")
    expect(record.final_response).toBe("DONE")
  })

  test("#given a start still waiting on the host #when the parent cancels it (a foreground abort) #then a late admission is discarded and the lane slot is free", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held, config: oneLane() })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: false })))
    if (started.kind !== "started") throw new Error("fixture did not start")

    // when
    const cancelled = await h.manager.cancelTask(started.task_id, "parent turn aborted")
    held.release.resolve(undefined)
    await bounded(held.admitted.promise)
    const next = await bounded(h.manager.start(baseSpec({ run_in_background: true })))

    // then
    expect(cancelled.kind).toBe("cancelled")
    expect(h.store.load(started.task_id)?.status).toBe("cancelled")
    expect(held.handles.get(started.task_id)?.subscribeCount()).toBe(0)
    if (next.kind !== "started") throw new Error("second start did not start")
    expect(next.queue_position).toBeUndefined()
  })

  test("#given a start still waiting on the host #when the caller awaits whenLaunched #then it settles only once the child is admitted and resident", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    expect(started.starting).toBe(true)
    const whenLaunched = h.manager.whenLaunched?.bind(h.manager)
    if (whenLaunched === undefined) throw new Error("the manager exposes no whenLaunched")
    let launched = false
    const settled = whenLaunched(started.task_id).then(() => { launched = true })

    // when
    held.release.resolve(undefined)
    await bounded(settled)

    // then
    expect(launched).toBe(true)
    expect(h.manager.getResidentHandle(started.task_id)).toBeDefined()
  })

  test("#given a start still waiting on the host #when the parent steers it #then the message is queued and delivered once the child is admitted", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    expect(started.starting).toBe(true)
    const delivered = Promise.withResolvers<void>()
    const append = h.store.appendEvent.bind(h.store)
    spyOn(h.store, "appendEvent").mockImplementation((id, event) => {
      const result = append(id, event)
      if (id === started.task_id && event.type === "steered") delivered.resolve()
      return result
    })

    // when
    const sent = await bounded(h.manager.sendToTask({ idOrName: started.task_id, message: "steer while starting", deliverAs: "steer" }))
    expect(sent.kind).toBe("queued")
    held.release.resolve(undefined)
    await bounded(delivered.promise)

    // then
    const handle = held.handles.get(started.task_id)
    if (handle === undefined) throw new Error("admitted child has no handle")
    expect(handle.steerCalls).toEqual(["steer while starting"])
    expect(handle.followUpCalls).toEqual([])
  })

  test("#given a task that waited for a lane and is now waiting on the host #when the parent steers it #then the message is queued and delivered once the child is admitted", async () => {
    // given
    const runner = new LaneThenBusyRunner()
    const h = makeManager({ inProcess: runner, config: oneLane() })
    const first = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (first.kind !== "started") throw new Error("first task did not start")
    const second = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (second.kind !== "started") throw new Error("second task did not start")
    expect(second.queue_position).toBeDefined()
    const firstHandle = runner.handles.get(first.task_id)
    if (firstHandle === undefined) throw new Error("first child has no handle")
    await bounded(firstHandle.waitForSubscription())
    const delivered = Promise.withResolvers<void>()
    const append = h.store.appendEvent.bind(h.store)
    spyOn(h.store, "appendEvent").mockImplementation((id, event) => {
      const result = append(id, event)
      if (id === second.task_id && event.type === "steered") delivered.resolve()
      return result
    })
    firstHandle.settle({ status: "completed", finalResponse: "DONE" })
    await bounded(runner.heldStart.promise)

    // when
    const sent = await bounded(h.manager.sendToTask({ idOrName: second.task_id, message: "steer while starting", deliverAs: "steer" }))
    expect(sent.kind).toBe("queued")
    runner.release.resolve()
    await bounded(delivered.promise)

    // then
    const handle = runner.handles.get(second.task_id)
    if (handle === undefined) throw new Error("admitted child has no handle")
    expect(handle.steerCalls).toEqual(["steer while starting"])
    expect(handle.followUpCalls).toEqual([])
  })

  test("#given a start still waiting on the host #when the session shuts down and the host admits it within the bound #then the child is resident before suspension runs", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    expect(started.starting).toBe(true)

    // when
    const settling = h.manager.settleLaunchesForShutdown?.(60_000)
    held.release.resolve(undefined)
    await bounded(settling ?? Promise.resolve())

    // then
    expect(h.manager.residentTaskIds()).toContain(started.task_id)
  })

  test("#given a start still waiting on the host #when the session shuts down and the host admits it only after the bound #then the late child is discarded, never attached to the closed session", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")

    // when
    await bounded(h.manager.settleLaunchesForShutdown?.(0) ?? Promise.resolve())
    held.release.resolve(undefined)
    await bounded(h.manager.whenLaunched?.(started.task_id) ?? Promise.resolve())

    // then
    expect(h.manager.residentTaskIds()).not.toContain(started.task_id)
    expect(held.handles.get(started.task_id)?.subscribeCount()).toBe(0)
    const parked = h.store.load(started.task_id)
    if (parked === null || parked === undefined) throw new Error("parked record missing")
    expect(parked.status).toBe("running")
    expect(parked.residency_state).toBe("persisted_only")
    expect(parked.host_pid).toBeUndefined()
    expect(parked.started_at).toBeUndefined()
    expect(isRevivalCandidate(parked, parked.parent_session_id)).toBe(true)
    expect(readEvents(h.store, started.task_id)).toContain("suspended")
  })

  test("#given a launch parked unadmitted at shutdown #when its session resumes #then reconcile relaunches it fresh instead of expiring it as unresumable", async () => {
    // given
    const held = new BusyHostRunner()
    const h = makeManager({ inProcess: held })
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    await bounded(h.manager.settleLaunchesForShutdown?.(0) ?? Promise.resolve())
    held.release.resolve(undefined)
    await bounded(h.manager.whenLaunched?.(started.task_id) ?? Promise.resolve())
    const parentSessionId = h.store.load(started.task_id)?.parent_session_id
    if (parentSessionId === undefined) throw new Error("parked record missing")
    const respawned: string[] = []
    const host = hostLifecycleDeps({
      store: h.store,
      hostPid: 999_999_993,
      respawn: async (record, resumeSessionPath) => {
        respawned.push(`${record.task_id}:${resumeSessionPath ?? "fresh"}`)
        return { ok: false, disposition: "retryable", code: "model_unavailable", reason: "fixture stops after the relaunch attempt" }
      },
    })
    const lifecycle = createTaskLifecycle({
      ...host.deps,
      registry: new SessionOwningRegistry(parentSessionId),
      config: settings(),
      reserveReattach: () => ({ ok: true, release: () => undefined }),
      reattach: async () => ({ ok: false, kind: "already_attached", reason: "fixture never attaches" }),
    })

    // when
    const reconciled = await bounded(lifecycle.reconcileOnSessionStart(parentSessionId))
    lifecycle.dispose?.()

    // then
    expect(respawned).toEqual([`${started.task_id}:fresh`])
    const outcome = reconciled.outcomes.find((candidate) => candidate.task_id === started.task_id)
    expect(outcome?.reason).not.toBe("transcript_unavailable")
  })

  test("#given a task queued for a lane #when the lane frees after session shutdown began #then no child starts and the task stays pending for shutdown to park", async () => {
    // given
    const runner = new FakeRunner()
    const h = makeManager({ inProcess: runner, config: oneLane() })
    const first = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (first.kind !== "started") throw new Error("first task did not start")
    const queued = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (queued.kind !== "started") throw new Error("second task did not start")
    expect(queued.queue_position).toBeDefined()
    const firstHandle = runner.handles.get(first.task_id)
    if (firstHandle === undefined) throw new Error("first child has no handle")
    await bounded(firstHandle.waitForSubscription())

    // when
    await bounded(h.manager.settleLaunchesForShutdown?.(0) ?? Promise.resolve())
    firstHandle.settle({ status: "completed", finalResponse: "DONE" })
    await bounded(h.manager.waitFor(first.task_id))
    await bounded(h.manager.whenLaunched?.(queued.task_id) ?? Promise.resolve())

    // then
    expect(runner.startedSpecs.map((spec) => spec.taskId)).not.toContain(queued.task_id)
    expect(h.store.load(queued.task_id)?.status).toBe("pending")
  })

  test("#given a host that answers at once #when a task starts #then the result is reported as before, not as starting", async () => {
    const h = makeManager()
    const started = await bounded(h.manager.start(baseSpec({ run_in_background: true })))
    if (started.kind !== "started") throw new Error("fixture did not start")
    expect(started.starting).toBeUndefined()
    expect(started.status).toBe("running")
  })
})

// allow: SIZE_OK - the lifecycle scenarios share one assembled-runtime fixture so compaction, restart, detach, wake batching, detached tool wait, viewer catch-up, and snapshot dedup are proven through the same adapter surface.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RunnerOutcome,
} from "@oh-my-opencode/senpi-task"
import * as dagEngine from "@oh-my-opencode/senpi-task/dag"
import { createDagManager, type DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import type { DagRunEvent, DagRunId } from "../../../../senpi-task/src/dag/types"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime, type DagRuntime } from "./dag-runtime"
import type {
  DagRpcEnvelope,
  DagRpcEvent,
  DagRpcHistoryPage,
  DagRpcSubscribeHandshake,
} from "./dag-rpc-handlers"
import { runDagTool } from "./dag-tool"
import { composeTaskEngine, type TaskEngine, type TaskRunnerFactories } from "./engine"
import type { CapturedUi } from "./runtime-context"
import { createSessionTransitionBridge } from "./session-transition-bridge"

const cleanupRoots: string[] = []
const sessionId = "session-dag-lifecycle"
const createFileStore = createDagFileStore

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
    expect(fs.existsSync(root)).toBe(false)
  }
})

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

// Failure ceiling, not synchronization: proves a promise settles promptly (or fails for blocking),
// matching the bounded-wait convention from senpi-task.
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms)
    }),
  ])
}

type ControlledChild = {
  readonly spec: ManagedStartSpec
  readonly settle: (output: string) => void
  readonly fail: (message: string) => void
}

class ControlledRunner implements ManagedRunner {
  readonly children: ControlledChild[] = []
  readonly #signals = new Map<number, ReturnType<typeof deferred<void>>>()

  constructor(private readonly abortError?: Error) {}

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const outcome = deferred<RunnerOutcome>()
    const handle: ManagedChildHandle = {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => {
        outcome.resolve({ status: "cancelled" })
        return this.abortError === undefined ? Promise.resolve() : Promise.reject(this.abortError)
      },
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }
    this.children.push({
      spec,
      settle: (output) => outcome.resolve({ status: "completed", finalResponse: output }),
      fail: (message) => outcome.resolve({ status: "error", failure: { kind: "child-turn-failed", message } }),
    })
    this.#signals.get(this.children.length)?.resolve()
    return Promise.resolve(handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.children.length >= count) return Promise.resolve()
    const signal = this.#signals.get(count) ?? deferred<void>()
    this.#signals.set(count, signal)
    return signal.promise
  }
}

class ManualTimers {
  readonly #timers = new Map<number, { readonly callback: () => void; readonly ms: number }>()
  #next = 0

  readonly seam = {
    set: (callback: () => void, ms: number): number => {
      this.#next += 1
      this.#timers.set(this.#next, { callback, ms })
      return this.#next
    },
    clear: (handle: ReturnType<typeof setTimeout> | number): void => {
      if (typeof handle === "number") this.#timers.delete(handle)
    },
  }

  flush(ms: number): void {
    const selected = [...this.#timers].filter(([, timer]) => timer.ms === ms)
    for (const [handle, timer] of selected) {
      this.#timers.delete(handle)
      timer.callback()
    }
  }
}

type RpcListener = (data: unknown) => void

type RpcHarness = {
  readonly events: Array<{ readonly name: string; readonly data: unknown }>
  readonly handlers: Map<string, (data: unknown) => unknown | Promise<unknown>>
  readonly listen: (name: string, listener: RpcListener) => () => void
  readonly call: (name: string, data: unknown) => Promise<unknown>
}

function rpcHarness() {
  const events: Array<{ readonly name: string; readonly data: unknown }> = []
  const handlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  const listeners = new Map<string, Set<RpcListener>>()
  const rpc: RpcHarness = {
    events,
    handlers,
    listen(name, listener) {
      const named = listeners.get(name) ?? new Set<RpcListener>()
      named.add(listener)
      listeners.set(name, named)
      return () => void named.delete(listener)
    },
    async call(name, data) {
      const handler = handlers.get(name)
      if (handler === undefined) throw new Error(`missing RPC handler ${name}`)
      return await handler(data)
    },
  }
  return {
    rpc,
    api: {
      emit(name: string, data: unknown) {
        events.push({ name, data })
        for (const listener of listeners.get(name) ?? []) listener(data)
      },
      handle(name: string, handler: (data: unknown) => unknown | Promise<unknown>) {
        handlers.set(name, handler)
      },
    },
  }
}

function logger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}

function fakeUi(widgetCalls: Array<string[] | undefined>): CapturedUi {
  return {
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (key, rows) => {
      if (key === "omo-dag") widgetCalls.push(rows)
    },
    select: async () => undefined,
    confirm: async () => false,
  }
}

type RuntimeFixtureOptions = {
  readonly project?: string
  readonly idle?: boolean
  readonly runner?: ControlledRunner
  readonly coordinator?: IdleInjectionCoordinator
  readonly attach?: boolean
  readonly awaitAttach?: boolean
  // Session id the fixture's engine reports; defaults to the module-wide sessionId. An adoption
  // test attaches under a DIFFERENT id to model fork/compaction/restart re-homing (#7316).
  readonly sessionId?: string
}

type RuntimeFixture = {
  readonly project: string
  readonly runner: ControlledRunner
  readonly engine: TaskEngine
  readonly runtime: DagRuntime
  readonly attached: Promise<void>
  readonly rpc: RpcHarness
  readonly bridgeTimers: ManualTimers
  readonly statusTimers: ManualTimers
  readonly widgetCalls: Array<string[] | undefined>
  readonly start: (key: string, nodes?: readonly { readonly id: string; readonly dependsOn?: readonly string[] }[]) => Promise<DagRunId>
}

function captureUnhandledRejections(): {
  readonly reasons: unknown[]
  readonly stop: () => void
} {
  const reasons: unknown[] = []
  const listener = (reason: unknown): void => { reasons.push(reason) }
  process.on("unhandledRejection", listener)
  return { reasons, stop: () => process.off("unhandledRejection", listener) }
}

async function runtimeFixture(options: RuntimeFixtureOptions = {}): Promise<RuntimeFixture> {
  const project = options.project ?? fs.mkdtempSync(join(tmpdir(), "omo-dag-lifecycle-"))
  if (options.project === undefined) cleanupRoots.push(project)
  const runner = options.runner ?? new ControlledRunner()
  const runnerFactories: TaskRunnerFactories = { inProcess: () => runner, process: () => runner }
  const bus = rpcHarness()
  const pi = Object.assign(new FakeExtensionAPI(), { rpc: bus.api })
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd: project }).config,
    cwd: project,
    sharedParentTools: () => [],
    runnerFactories,
    ...(options.coordinator === undefined ? {} : { coordinator: options.coordinator }),
  })
  const widgetCalls: Array<string[] | undefined> = []
  engine.runtime.captureFrom({
    mode: "tui",
    ui: fakeUi(widgetCalls),
    sessionManager: { getSessionId: () => options.sessionId ?? sessionId },
    isIdle: () => options.idle ?? false,
  })
  const bridgeTimers = new ManualTimers()
  const statusTimers = new ManualTimers()
  const createStore = spyOn(dagEngine, "createDagFileStore").mockImplementation((config, storeOptions = {}) =>
    createFileStore(config, { ...storeOptions, fsync: false }))
  let runtime: DagRuntime
  try {
    runtime = createDagRuntime({
      pi,
      engine,
      logger: logger(),
      ...(options.coordinator === undefined ? {} : { coordinator: options.coordinator }),
      bridgeTimers: bridgeTimers.seam,
      statusUiTimers: statusTimers.seam,
    })
  } finally {
    createStore.mockRestore()
  }
  const attached = options.attach === false ? Promise.resolve() : runtime.attach()
  if (options.attach !== false && options.awaitAttach !== false) await attached

  return {
    project,
    runner,
    engine,
    runtime,
    attached,
    rpc: bus.rpc,
    bridgeTimers,
    statusTimers,
    widgetCalls,
    async start(key, nodes = [{ id: "work" }]) {
      const started = await runDagTool(
        toolDeps(runtime),
        {
          action: "start",
          definition: {
            key,
            name: key.replaceAll("-", " "),
            nodes: nodes.map((node) => ({
              id: node.id,
              prompt: `do ${node.id}`,
              subagent_type: "explore",
              model: "omo-mock/mock-1",
              ...(node.dependsOn === undefined ? {} : { dependsOn: [...node.dependsOn] }),
            })),
          },
        },
      )
      if (started.details.kind !== "started") throw new Error(`expected dag start, received ${started.details.kind}`)
      return started.details.run_id as DagRunId
    },
  }
}

function toolDeps(runtime: DagRuntime) {
  return {
    manager: runtime.manager,
    parentSessionId: () => sessionId,
    rootSessionId: () => sessionId,
    wait: runtime.wait,
    cancel: runtime.cancel,
    retry: runtime.retry,
    send: runtime.send,
    amend: runtime.amend,
  }
}

function events(fixture: RuntimeFixture, runId: DagRunId): readonly DagRunEvent[] {
  return fixture.runtime.manager.history({ runId, parentSessionId: sessionId, limit: 256 }).events
}

function pauseForShutdown(runtime: DagRuntime): void {
  const candidate: Partial<Pick<DagRuntime, "pauseForShutdown">> = runtime
  candidate.pauseForShutdown?.()
}

async function seedPendingRun(project: string, runId: DagRunId): Promise<void> {
  await createDagManager({
    store: createFileStore({ project_dir: project }, { fsync: false }),
    newRunId: () => runId,
  }).start({
    parentSessionId: sessionId,
    rootSessionId: sessionId,
    definition: {
      key: "restart-proof",
      name: "restart proof",
      nodes: [{ id: "resume", prompt: "resume", subagent_type: "explore", model: "omo-mock/mock-1" }],
    },
  })
}

function expectOk<T>(value: unknown): T {
  const envelope = value as DagRpcEnvelope<T>
  if (!envelope.ok) throw new Error(`expected ok RPC envelope, received ${JSON.stringify(envelope)}`)
  return envelope.value
}

class ReferenceDagViewer {
  readonly applied: DagRpcEvent[] = []
  readonly gaps: Array<{ readonly expected: number; readonly received: number }> = []
  readonly seen = new Set<string>()
  #liveWork = Promise.resolve()
  #catchingUp = true
  readonly #buffer: DagRpcEvent[] = []

  constructor(
    private readonly rpc: Pick<RpcHarness, "listen" | "call">,
    private readonly runId: string,
  ) {}

  async catchUp(): Promise<DagRpcSubscribeHandshake> {
    this.rpc.listen("omo.dag.event", (data) => {
      const event = data as DagRpcEvent
      if (event.runId !== this.runId) return
      if (this.#catchingUp) this.#buffer.push(event)
      else this.#liveWork = this.#liveWork.then(() => this.applyLive(event))
    })
    const handshake = expectOk<DagRpcSubscribeHandshake>(
      await this.rpc.call("omo.dag.subscribe", { runId: this.runId, limit: 2 }),
    )
    this.applyPage(handshake.page.events)
    let page = handshake.page
    while (page.hasMore) {
      page = expectOk<DagRpcHistoryPage>(await this.rpc.call("omo.dag.history", {
        runId: this.runId,
        sinceSeq: page.nextSinceSeq,
        throughSeq: handshake.highWaterSeq,
        limit: 2,
      }))
      this.applyPage(page.events)
    }
    for (const event of this.#buffer.splice(0).sort((left, right) => left.seq - right.seq)) this.apply(event)
    this.#catchingUp = false
    return handshake
  }

  async idle(): Promise<void> {
    await this.#liveWork
  }

  private applyPage(page: readonly DagRpcEvent[]): void {
    for (const event of page) this.apply(event)
  }

  private async applyLive(event: DagRpcEvent): Promise<void> {
    if (this.seen.has(this.key(event))) return
    if (event.seq > this.lastSeq() + 1) {
      const page = expectOk<DagRpcHistoryPage>(await this.rpc.call("omo.dag.history", {
        runId: this.runId,
        sinceSeq: this.lastSeq(),
        throughSeq: event.seq - 1,
        limit: 256,
      }))
      this.applyPage(page.events)
    }
    this.apply(event)
  }

  private apply(event: DagRpcEvent): void {
    if (this.seen.has(this.key(event))) return
    const expected = this.lastSeq() + 1
    if (event.seq !== expected) this.gaps.push({ expected, received: event.seq })
    this.seen.add(this.key(event))
    this.applied.push(event)
  }

  private lastSeq(): number {
    return this.applied.at(-1)?.seq ?? 0
  }

  private key(event: DagRpcEvent): string {
    return `${event.runId}\0${event.seq}`
  }
}

describe("assembled DAG lifecycle end to end", () => {
  test("#given a live run #when its session compacts #then events continue without a pause and the TUI refreshes after the post-compact event", async () => {
    // given
    const fixture = await runtimeFixture()
    const transitions = createSessionTransitionBridge({
      runtime: fixture.engine.runtime,
      notifier: fixture.engine.notifier,
    })
    const runId = await fixture.start("compact-continuation", [
      { id: "before" },
      { id: "after", dependsOn: ["before"] },
    ])
    await fixture.runner.whenStarted(1)
    fixture.statusTimers.flush(250)
    const paintsBeforeCompact = fixture.widgetCalls.length

    // when
    transitions.onBeforeCompact(sessionId)
    fixture.runner.children[0]?.settle("before compact output")
    await fixture.runner.whenStarted(2)
    transitions.onCompact(sessionId)
    fixture.runner.children[1]?.settle("after compact output")
    const result = await fixture.runtime.wait(runId, sessionId)
    const paintsBeforeRefresh = fixture.widgetCalls.length
    fixture.statusTimers.flush(1_000)

    // then
    const persisted = events(fixture, runId)
    expect(result.status).toBe("completed")
    expect(persisted.map((event) => event.seq)).toEqual(
      Array.from({ length: persisted.length }, (_, index) => index + 1),
    )
    expect(persisted.some((event) => event.type === "dag.run.paused")).toBe(false)
    expect(paintsBeforeCompact).toBeGreaterThan(0)
    expect(paintsBeforeRefresh).toBe(paintsBeforeCompact)
    expect(fixture.widgetCalls).toHaveLength(paintsBeforeRefresh + 1)
    expect(fixture.widgetCalls.at(-1)).toBeUndefined()
  })

  test("#given a pending adapter run #when shutdown persists a pause and a fresh adapter attaches #then it claims, resumes, and completes the run", async () => {
    // given
    const project = fs.mkdtempSync(join(tmpdir(), "omo-dag-lifecycle-restart-"))
    cleanupRoots.push(project)
    const runId = "dag-lifecycle-restart" as DagRunId
    await seedPendingRun(project, runId)
    const first = await runtimeFixture({ project, attach: false })

    // when
    pauseForShutdown(first.runtime)
    first.runtime.dispose()

    // then
    const store = createFileStore({ project_dir: project }, { fsync: false })
    const paused = store.readCheckpoint<DagRunRecordV1 & { readonly previousLeaseHolderPid?: number }>(runId)
    expect(paused?.status).toBe("paused")
    expect(store.readEvents(runId, 0, { limit: 256 }).events.at(-1)).toEqual(expect.objectContaining({
      type: "dag.run.paused",
      reason: "session_shutdown",
    }))

    // given a restart whose predecessor lease holder is dead
    if (paused === null) throw new Error("expected paused checkpoint")
    store.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: 2_147_483_647 })
    const resumedRunner = new ControlledRunner()
    const restarted = await runtimeFixture({ project, runner: resumedRunner, awaitAttach: false })

    // when
    await resumedRunner.whenStarted(1)
    resumedRunner.children[0]?.settle("resumed output")
    await restarted.attached
    const result = await restarted.runtime.wait(runId, sessionId)

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.resume).toEqual(expect.objectContaining({ state: "completed", output: "resumed output" }))
    expect(store.readEvents(runId, 0, { limit: 256 }).events.map((event) => event.type)).toContain("dag.run.resumed")
    restarted.runtime.dispose()
  })

  test("#given a paused run whose owner session is gone #when a fresh session id attaches over a dead lease #then it adopts, re-homes, and completes the run", async () => {
    // given a run paused by its original session, whose process has since died (#7316)
    const project = fs.mkdtempSync(join(tmpdir(), "omo-dag-lifecycle-adopt-"))
    cleanupRoots.push(project)
    const runId = "dag-lifecycle-adopt" as DagRunId
    await seedPendingRun(project, runId)
    const first = await runtimeFixture({ project, attach: false })
    pauseForShutdown(first.runtime)
    first.runtime.dispose()
    const store = createFileStore({ project_dir: project }, { fsync: false })
    const paused = store.readCheckpoint<DagRunRecordV1 & { readonly previousLeaseHolderPid?: number }>(runId)
    if (paused === null) throw new Error("expected paused checkpoint")
    store.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: 2_147_483_647 })

    // when a session with a NEW id attaches (fork / compaction / restart under a new id)
    const adopterRunner = new ControlledRunner()
    const adopter = await runtimeFixture({ project, runner: adopterRunner, sessionId: "session-adopter", awaitAttach: false })
    const adopted = await Promise.race([
      adopterRunner.whenStarted(1).then(() => true),
      // Today attach resolves WITHOUT adopting the foreign run, so the race falls through false.
      adopter.attached.then(() => false),
    ])

    // then the adopter schedules the orphaned node instead of skipping it as foreign
    expect(adopted).toBe(true)
    adopterRunner.children[0]?.settle("adopted output")
    await adopter.attached
    expect(adopter.runtime.manager.list("session-adopter").some((run) => run.runId === runId)).toBe(true)
    const result = await adopter.runtime.wait(runId, "session-adopter")
    expect(result.status).toBe("completed")
    expect(result.nodes.resume).toEqual(expect.objectContaining({ state: "completed", output: "adopted output" }))
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.parentSessionId).toBe("session-adopter")
    adopter.runtime.dispose()
  })

  test("#given a paused run recovering on session start #when the bridge emits its first dag snapshot #then it reflects the recovered run, never the pre-recovery pause", async () => {
    // given a paused run with a dead predecessor lease, exactly as a host restart leaves it
    const project = fs.mkdtempSync(join(tmpdir(), "omo-dag-lifecycle-snapshot-"))
    cleanupRoots.push(project)
    const runId = "dag-lifecycle-first-snapshot" as DagRunId
    await seedPendingRun(project, runId)
    const first = await runtimeFixture({ project, attach: false })
    pauseForShutdown(first.runtime)
    first.runtime.dispose()
    const store = createFileStore({ project_dir: project }, { fsync: false })
    const paused = store.readCheckpoint<DagRunRecordV1 & { readonly previousLeaseHolderPid?: number }>(runId)
    if (paused === null) throw new Error("expected paused checkpoint")
    store.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: 2_147_483_647 })

    const runner = new ControlledRunner()
    const fixture = await runtimeFixture({ project, runner, attach: false })
    const statusOf = (event: { readonly name: string; readonly data: unknown }): string | undefined => {
      if (event.name !== "omo.dag.updated") return undefined
      const payload = event.data as { readonly runs?: ReadonlyArray<{ readonly run_id?: string; readonly status?: string }> }
      return payload.runs?.find((run) => run.run_id === runId)?.status
    }

    // when the bridge flush window fires while recovery is still reconciling (#7316 defect 1)
    const attaching = fixture.runtime.attach()
    fixture.bridgeTimers.flush(50)
    const preRecovery = fixture.rpc.events
      .map(statusOf)
      .filter((status): status is string => status !== undefined)

    await runner.whenStarted(1)
    runner.children[0]?.settle("first snapshot output")
    await attaching
    fixture.bridgeTimers.flush(50)

    // then no consumer ever observed the stale pre-recovery pause, and the final snapshot is live
    expect(preRecovery).not.toContain("paused")
    const statuses = fixture.rpc.events
      .map(statusOf)
      .filter((status): status is string => status !== undefined)
    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.at(-1)).toBe("completed")
    fixture.runtime.dispose()
  })

  test("#given an eval-cell waiter that is abandoned #when a later cell re-attaches and calls done #then the shipped handle returns the result", async () => {
    // given
    const fixture = await runtimeFixture()
    const runId = await fixture.start("detach-safe")
    await fixture.runner.whenStarted(1)
    void fixture.runtime.wait(runId, sessionId)

    // when
    const reattached = fixture.runtime.manager.attach(runId, sessionId)
    expect(typeof reattached.done).toBe("function")
    expect(typeof reattached.cancel).toBe("function")
    expect(reattached.snapshot().status).toBe("running")
    fixture.runner.children[0]?.settle("detached result")
    const result = await reattached.done()

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.work).toEqual(expect.objectContaining({ state: "completed", output: "detached result" }))
    expect(events(fixture, runId).filter((event) => event.type === "dag.run.cancelled")).toHaveLength(0)
  })

  test("#given a shipped handle for a live child #when it cancels the run #then no abort rejection escapes and a later handle settles", async () => {
    // given
    const fixture = await runtimeFixture({
      runner: new ControlledRunner(new DOMException("intentional child abort", "AbortError")),
    })
    const runId = await fixture.start("handle-cancel", [
      { id: "live" },
      { id: "after", dependsOn: ["live"] },
    ])
    await fixture.runner.whenStarted(1)
    const handle = fixture.runtime.manager.attach(runId, sessionId)
    const before = handle.done()
    const unhandled = captureUnhandledRejections()

    try {
      // when
      await handle.cancel("assembled cancel")
      const after = await fixture.runtime.manager.attach(runId, sessionId).done()
      const beforeResult = await before
      await new Promise<void>((resolve) => setImmediate(resolve))

      // then
      expect(beforeResult.status).toBe("cancelled")
      expect(after.status).toBe("cancelled")
      expect(after.nodes.live).toEqual(expect.objectContaining({ state: "cancelled", reason: "assembled cancel" }))
      expect(after.nodes.after).toEqual(expect.objectContaining({ state: "cancelled", reason: "assembled cancel" }))
      expect(unhandled.reasons).toEqual([])
      expect(fixture.runner.children).toHaveLength(1)
    } finally {
      unhandled.stop()
    }
  })

  test("#given two terminal DAG notifications in one streaming flush window #when the window flushes #then exactly one batched steer is delivered", async () => {
    // given
    const scheduled: Array<() => void> = []
    const deliveries: Array<{ readonly content: string; readonly deliverAs: string }> = []
    const coordinator = new IdleInjectionCoordinator(
      (message, options) => { deliveries.push({ content: message.content, deliverAs: options.deliverAs }) },
      { scheduleFlush: (flush) => scheduled.push(flush) },
    )
    const fixture = await runtimeFixture({ coordinator, idle: false })
    const first = await fixture.start("wake-first")
    const second = await fixture.start("wake-second")
    await fixture.runner.whenStarted(2)

    // when
    fixture.runner.children[0]?.settle("first output")
    fixture.runner.children[1]?.settle("second output")
    await Promise.all([
      fixture.runtime.wait(first, sessionId),
      fixture.runtime.wait(second, sessionId),
    ])

    // then
    expect(scheduled).toHaveLength(1)
    expect(deliveries).toHaveLength(0)
    scheduled[0]?.()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.deliverAs).toBe("steer")
    expect(deliveries[0]?.content).toContain("wake first")
    expect(deliveries[0]?.content).toContain("wake second")
  })

  test("#given a live run #when the dag TOOL waits with the default detach #then it returns immediately and the settle still delivers the terminal wake", async () => {
    // given
    const scheduled: Array<() => void> = []
    const deliveries: Array<{ readonly content: string; readonly deliverAs: string }> = []
    const coordinator = new IdleInjectionCoordinator(
      (message, options) => { deliveries.push({ content: message.content, deliverAs: options.deliverAs }) },
      { scheduleFlush: (flush) => scheduled.push(flush) },
    )
    const fixture = await runtimeFixture({ coordinator, idle: false })
    const runId = await fixture.start("wake-detached")
    await fixture.runner.whenStarted(1)

    // when the model-facing default wait runs against a live run
    const waiting = runDagTool(toolDeps(fixture.runtime), { action: "wait", run_id: runId })
    const outcome = await within(waiting, 250).then(
      (result) => ({ kind: "resolved" as const, result }),
      () => ({ kind: "blocked" as const }),
    )
    if (outcome.kind === "blocked") {
      // release the blocked call so the fixture tears down cleanly, then fail for the right reason
      fixture.runner.children[0]?.settle("release the blocked wait")
      await waiting
      throw new Error("the default wait blocked until settle instead of detaching")
    }

    // then it detached with the live snapshot, before the child settled
    const waited = outcome.result
    if (waited.details.kind !== "detached") throw new Error(`expected detached wait, received ${waited.details.kind}`)
    expect(waited.details.snapshot.status).toBe("running")

    // and when the run settles, the terminal wake still flushes through the coordinator
    fixture.runner.children[0]?.settle("detached wake output")
    await fixture.runtime.wait(runId, sessionId)
    expect(scheduled).toHaveLength(1)
    scheduled[0]?.()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.deliverAs).toBe("steer")
    expect(deliveries[0]?.content).toContain("wake detached")
    expect(deliveries[0]?.content).toContain("completed")
  })

  test("#given the reference viewer attached to a live adapter run #when the run completes #then catch-up and live delivery contain zero gaps and zero duplicates", async () => {
    // given
    const fixture = await runtimeFixture()
    const runId = await fixture.start("viewer-live", [
      { id: "plan" },
      { id: "build", dependsOn: ["plan"] },
    ])
    await fixture.runner.whenStarted(1)
    const viewer = new ReferenceDagViewer(fixture.rpc, runId)

    // when
    const handshake = await viewer.catchUp()
    fixture.runner.children[0]?.settle("plan output")
    await fixture.runner.whenStarted(2)
    fixture.runner.children[1]?.settle("build output")
    await fixture.runtime.wait(runId, sessionId)
    await viewer.idle()

    // then
    const head = fixture.runtime.manager.snapshot(runId, sessionId).lastSeq
    expect(handshake.highWaterSeq).toBeGreaterThan(0)
    expect(viewer.gaps).toEqual([])
    expect(viewer.applied.map((event) => event.seq)).toEqual(
      Array.from({ length: head }, (_, index) => index + 1),
    )
    expect(viewer.seen.size).toBe(viewer.applied.length)
  })

  test("#given bursty adapter mutations with an identical final state #when the snapshot window flushes #then omo.dag.updated emits that state once", async () => {
    // given
    const fixture = await runtimeFixture()
    await fixture.start("snapshot-dedup")
    await fixture.runner.whenStarted(1)

    // when
    fixture.runtime.sync()
    fixture.runtime.sync()
    fixture.runtime.sync()
    fixture.bridgeTimers.flush(50)
    const firstWindow = fixture.rpc.events.filter((event) => event.name === "omo.dag.updated")
    fixture.runtime.sync()
    fixture.runtime.sync()
    fixture.bridgeTimers.flush(50)
    const secondWindow = fixture.rpc.events.filter((event) => event.name === "omo.dag.updated")

    // then
    expect(firstWindow).toHaveLength(1)
    expect(secondWindow).toHaveLength(1)
    expect((firstWindow[0]?.data as { runs: readonly { status: string }[] }).runs[0]?.status).toBe("running")
  })
})

describe("assembled DAG retry lifecycle end to end", () => {
  test("#given a diamond run whose middle node fails #when the dag TOOL retries it #then wait settles completed and the untouched nodes keep their original children", async () => {
    // given
    const fixture = await runtimeFixture()
    const runId = await fixture.start("retry-diamond", [
      { id: "root" },
      { id: "left", dependsOn: ["root"] },
      { id: "right", dependsOn: ["root"] },
      { id: "join", dependsOn: ["left", "right"] },
    ])
    await fixture.runner.whenStarted(1)
    fixture.runner.children[0]?.settle("root output")
    await fixture.runner.whenStarted(3)
    const byNode = (index: number): string => String(fixture.runner.children[index]?.spec.taskId)
    const rootTaskId = byNode(0)
    // left fails, right completes: the join node is skipped by the dependent cascade
    fixture.runner.children[1]?.fail("left blew up")
    fixture.runner.children[2]?.settle("right output")
    const failed = await fixture.runtime.wait(runId, sessionId)
    expect(failed.status).toBe("failed")
    expect(failed.nodes.join).toEqual(expect.objectContaining({ state: "skipped" }))
    const rightTaskId = byNode(2)

    // when the tool retries the failed node
    const retried = await runDagTool(toolDeps(fixture.runtime), { action: "retry", run_id: runId })
    expect(retried.details.kind).toBe("retried")
    await fixture.runner.whenStarted(4)
    fixture.runner.children[3]?.settle("left retried")
    await fixture.runner.whenStarted(5)
    fixture.runner.children[4]?.settle("join output")
    const waited = await runDagTool(toolDeps(fixture.runtime), { action: "wait", run_id: runId, detach: false })

    // then
    if (waited.details.kind !== "waited") throw new Error(`expected wait, received ${waited.details.kind}`)
    expect(waited.details.result.status).toBe("completed")
    expect(waited.details.result.nodes.left).toEqual(expect.objectContaining({ state: "completed", output: "left retried" }))
    expect(waited.details.result.nodes.join).toEqual(expect.objectContaining({ state: "completed", output: "join output" }))
    const record = fixture.runtime.manager.record(runId, sessionId)
    expect(record.nodes.find((node) => String(node.id) === "root")?.taskId).toBe(rootTaskId)
    expect(record.nodes.find((node) => String(node.id) === "right")?.taskId).toBe(rightTaskId)
    expect(events(fixture, runId).some((event) => event.type === "dag.node.retried")).toBe(true)
    fixture.runtime.dispose()
  }, { timeout: 20_000 })
})

import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type {
  ManagedChildHandle,
  ManagedRunner,
  ManagedStartSpec,
  RunnerOutcome,
} from "@oh-my-opencode/senpi-task"
import {
  createDagFileStore,
  createDagManager,
  type DagLeaseWatchTimerHandle,
  type DagLeaseWatchTimers,
  type DagRunEvent,
  type DagRunId,
  type DagRunRecordV1,
} from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime, type DagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"

const cleanupRoots: string[] = []
const STEP_BUDGET_MS = 3_000
// Above every reachable pid, so it can only ever be "alive" through the injected probe.
const FOREIGN_HOST_PID = 2_147_483_647

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function within<T>(promise: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`within(${STEP_BUDGET_MS}ms) exceeded while awaiting ${step}`)), STEP_BUDGET_MS)
  })
  return Promise.race([promise, bound]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

class ScriptedRunner implements ManagedRunner {
  readonly handles: Array<{ readonly spec: ManagedStartSpec; readonly settle: (output: string) => void }> = []
  readonly #started = new Map<number, ReturnType<typeof deferred<void>>>()

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
        return Promise.resolve()
      },
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }
    this.handles.push({ spec, settle: (output) => outcome.resolve({ status: "completed", finalResponse: output }) })
    this.#started.get(this.handles.length)?.resolve()
    return Promise.resolve(handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.handles.length >= count) return Promise.resolve()
    const signal = this.#started.get(count) ?? deferred<void>()
    this.#started.set(count, signal)
    return signal.promise
  }
}

class ManualTimers implements DagLeaseWatchTimers {
  readonly #timers = new Map<number, () => void>()
  #next = 0

  set(callback: () => void): number {
    this.#next += 1
    this.#timers.set(this.#next, callback)
    return this.#next
  }

  clear(handle: DagLeaseWatchTimerHandle): void {
    if (typeof handle === "number") this.#timers.delete(handle)
  }

  pending(): number {
    return this.#timers.size
  }

  tick(): void {
    const due = [...this.#timers.values()]
    this.#timers.clear()
    for (const callback of due) callback()
  }
}

type WarnRecord = { readonly message: string; readonly fields: Record<string, unknown> | undefined }

/**
 * Who paused the run the successor runtime finds. The first runtime always pauses it under THIS
 * process's pid; a cross-host handoff (what the lease watch exists for) is made honest by re-stamping
 * the predecessor as a foreign pid the injected probe controls. `same-host` keeps the checkpoint as
 * written - `previousLeaseHolderPid === process.pid` - which is the saved-session reopen of #8006.
 */
type Predecessor = "foreign-host" | "same-host"

async function pausedHandoffFixture(name: string, predecessor: Predecessor = "foreign-host") {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-lease-${name}-`))
  cleanupRoots.push(cwd)
  const runId = `dag-lease-${name}` as DagRunId
  const sessionId = `session-lease-${name}`
  const store = createDagFileStore({ project_dir: cwd })
  await createDagManager({ store, newRunId: () => runId }).start({
    parentSessionId: sessionId,
    rootSessionId: sessionId,
    definition: {
      key: `lease-${runId}`,
      name: "lease handoff",
      nodes: [{ id: "resume", prompt: "resume", subagent_type: "explore", model: "omo-mock/mock-1" }],
    },
  })
  const firstPi = new FakeExtensionAPI()
  const firstEngine = composeTaskEngine({
    pi: firstPi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => new ScriptedRunner(), process: () => new ScriptedRunner() },
  })
  firstEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
  const firstRuntime = createDagRuntime({ pi: firstPi, engine: firstEngine, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
  // #8020: retirement now drains the scheduler before releasing the lease, so the
  // pause is awaited; the fixture must not observe the checkpoint mid-drain.
  await firstRuntime.pauseForShutdown()
  firstRuntime.dispose()
  if (predecessor === "foreign-host") {
    const paused = store.readCheckpoint<DagRunRecordV1>(runId)
    if (paused === null) throw new Error("expected the first runtime to pause the run")
    store.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: FOREIGN_HOST_PID })
  }

  const holder = { alive: true }
  const timers = new ManualTimers()
  const warnings: WarnRecord[] = []
  const runner = new ScriptedRunner()
  const pi = new FakeExtensionAPI()
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  engine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
  // The same-host probe says EVERY pid is alive: the reopen must be decided by identity, not liveness.
  const isProcessAlive = predecessor === "foreign-host"
    ? (pid: number) => pid === FOREIGN_HOST_PID && holder.alive
    : () => true
  const runtime: DagRuntime = createDagRuntime({
    pi,
    engine,
    logger: {
      info: () => undefined,
      warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, fields }),
      error: () => undefined,
    },
    leaseWatch: { isProcessAlive, timers, intervalMs: 250 },
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 100 }).events
  const status = (): string => store.readCheckpoint<{ readonly status: string }>(runId)?.status ?? "missing"
  return { runId, sessionId, holder, timers, warnings, runner, runtime, events, status }
}

/** One runtime that starts a run, keeps its scheduler registered, and pauses it for its own shutdown. */
async function ownRuntimePauseFixture(name: string) {
  const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-lease-${name}-`))
  cleanupRoots.push(cwd)
  const sessionId = `session-lease-${name}`
  const store = createDagFileStore({ project_dir: cwd })
  const timers = new ManualTimers()
  const warnings: WarnRecord[] = []
  const runner = new ScriptedRunner()
  const pi = new FakeExtensionAPI()
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  engine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
  const runtime: DagRuntime = createDagRuntime({
    pi,
    engine,
    logger: {
      info: () => undefined,
      warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, fields }),
      error: () => undefined,
    },
    leaseWatch: { isProcessAlive: () => true, timers, intervalMs: 250 },
  })
  await within(runtime.attach(), "attach")
  const started = await within(runtime.manager.start({
    parentSessionId: sessionId,
    rootSessionId: sessionId,
    definition: {
      key: `lease-own-${name}`,
      name: "own runtime pause",
      nodes: [{ id: "resume", prompt: "resume", subagent_type: "explore", model: "omo-mock/mock-1" }],
    },
  }), "manager.start")
  const runId = started.snapshot.runId
  await within(runner.whenStarted(1), "runner.whenStarted(1)")
  await runtime.pauseForShutdown()
  const status = (): string => store.readCheckpoint<{ readonly status: string }>(runId)?.status ?? "missing"
  return { runId, sessionId, timers, warnings, runner, runtime, status }
}

describe("DAG runtime recovery across a host handoff", () => {
  test("#given a paused run whose previous host is still exiting on session start #when that host exits #then the run is claimed, resumed, and completes without another session start", async () => {
    // given
    const fixture = await pausedHandoffFixture("resumes")
    const { runId, sessionId, holder, timers, warnings, runner, runtime, events, status } = fixture

    // when the successor attaches while the predecessor pid is still alive
    await within(runtime.attach(), "attach")

    // then the run stays paused, the deferral is logged, and one poll is armed
    expect(status()).toBe("paused")
    expect(events().some((event) => event.type === "dag.run.resumed")).toBe(false)
    expect(warnings.some((entry) => entry.fields?.runId === runId && entry.fields?.holderPid === FOREIGN_HOST_PID)).toBe(true)
    expect(timers.pending()).toBe(1)

    // when the predecessor keeps running across two polls
    timers.tick()
    timers.tick()

    // then nothing is claimed early
    expect(status()).toBe("paused")
    expect(runner.handles).toHaveLength(0)
    expect(timers.pending()).toBe(1)

    // when the predecessor exits before the next poll
    holder.alive = false
    timers.tick()
    await within(runner.whenStarted(1), "runner.whenStarted(1)")
    runner.handles[0]?.settle("resumed after handoff")
    const result = await within(runtime.wait(runId, sessionId), "runtime.wait")

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.resume).toEqual(expect.objectContaining({ state: "completed", output: "resumed after handoff" }))
    expect(events().some((event) => event.type === "dag.run.resumed")).toBe(true)
    expect(timers.pending()).toBe(0)
    runtime.dispose()
  })

  test("#given a lease watch armed on session start #when the runtime is disposed before the holder exits #then the poll is cancelled and the run is never claimed by the dead runtime", async () => {
    // given
    const { holder, timers, runner, runtime, events, status } = await pausedHandoffFixture("disposed")
    await within(runtime.attach(), "attach")
    expect(timers.pending()).toBe(1)

    // when
    runtime.dispose()
    holder.alive = false
    timers.tick()

    // then
    expect(timers.pending()).toBe(0)
    expect(status()).toBe("paused")
    expect(events().some((event) => event.type === "dag.run.resumed")).toBe(false)
    expect(runner.handles).toHaveLength(0)
  })

  test("#given a lease watch armed on session start #when the session switches away before the holder exits #then the poll is cancelled with the detach", async () => {
    // given
    const { holder, timers, runner, runtime, status } = await pausedHandoffFixture("detached")
    await within(runtime.attach(), "attach")
    expect(timers.pending()).toBe(1)

    // when
    runtime.detach()
    holder.alive = false
    timers.tick()

    // then
    expect(timers.pending()).toBe(0)
    expect(status()).toBe("paused")
    expect(runner.handles).toHaveLength(0)
    runtime.dispose()
  })
})

describe("DAG runtime recovery when the same host reopens the session", () => {
  test("#given a paused run whose previous host is THIS process and whose session runtime was disposed #when the same host reopens the session #then attach claims and resumes it without arming a lease watch", async () => {
    // given - the checkpoint still names process.pid as the predecessor and the probe calls every pid alive
    const { runId, sessionId, timers, warnings, runner, runtime, events, status } = await pausedHandoffFixture("same-host", "same-host")

    // when the successor runtime attaches in the same process (attach settles only once the claimed
    // run does, so the child is admitted first and settled below)
    const attaching = runtime.attach()
    await within(Promise.race([runner.whenStarted(1), attaching]), "the successor to claim the run")

    // then the run was claimed instead of being left paused behind our own pid
    expect(runner.handles).toHaveLength(1)
    expect(status()).toBe("running")
    runner.handles[0]?.settle("resumed in the same host")
    await within(attaching, "attach")
    const result = await within(runtime.wait(runId, sessionId), "runtime.wait")
    expect(result.status).toBe("completed")
    expect(result.nodes.resume).toEqual(expect.objectContaining({ state: "completed", output: "resumed in the same host" }))
    expect(events().some((event) => event.type === "dag.run.resumed")).toBe(true)
    expect(timers.pending()).toBe(0)
    expect(warnings.some((entry) => entry.fields?.runId === runId && entry.fields?.holderPid === process.pid)).toBe(false)
    runtime.dispose()
  })

  test("#given a running run paused by its own runtime #when that same runtime re-attaches in the same process #then the reclaim reuses the durable child and no second scheduler admits the node", async () => {
    // given - the committed shutdown retired this runtime's scheduler, so nothing holds the run in
    // this process any more and the reopen is a handoff rather than a fenced no-op (#8020).
    const { timers, runner, runtime, status } = await ownRuntimePauseFixture("same-runtime")
    expect(status()).toBe("paused")
    expect(runner.handles).toHaveLength(1)

    // when - attach settles only once the reclaimed run does, so the child that survived the pause
    // is the one that has to carry it to completion.
    const attaching = runtime.attach()
    timers.tick()
    timers.tick()
    runner.handles[0]?.settle("resumed after retirement")
    await within(attaching, "attach")

    // then the run finished through that SAME child: a second scheduler would have admitted a second
    // one, and a stranded run would never have left "paused".
    expect(runner.handles).toHaveLength(1)
    expect(status()).toBe("completed")
    runtime.dispose()
  })

  test("#given a running run paused by its own runtime #when that same runtime re-attaches #then no lease watch is armed on this host's own pid and no handoff deferral is logged", async () => {
    // given
    const { runId, timers, warnings, runner, runtime } = await ownRuntimePauseFixture("self-watch")

    // when
    const attaching = runtime.attach()
    runner.handles[0]?.settle("resumed after retirement")
    await within(attaching, "attach")

    // then - a watch on our own pid could only fire once this process is gone, and the deferral
    // warning it would log ("resuming once that pid is gone") could never come true
    expect(timers.pending()).toBe(0)
    expect(warnings.filter((entry) => entry.fields?.runId === runId && entry.fields?.holderPid === process.pid)).toEqual([])
    runtime.dispose()
  })
})

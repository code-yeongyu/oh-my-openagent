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
} from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime, type DagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"

const cleanupRoots: string[] = []
const STEP_BUDGET_MS = 3_000

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

async function pausedHandoffFixture(name: string) {
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
  firstRuntime.pauseForShutdown()
  firstRuntime.dispose()

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
  const runtime: DagRuntime = createDagRuntime({
    pi,
    engine,
    logger: {
      info: () => undefined,
      warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, fields }),
      error: () => undefined,
    },
    leaseWatch: { isProcessAlive: () => holder.alive, timers, intervalMs: 250 },
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 100 }).events
  const status = (): string => store.readCheckpoint<{ readonly status: string }>(runId)?.status ?? "missing"
  return { runId, sessionId, holder, timers, warnings, runner, runtime, events, status }
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
    expect(warnings.some((entry) => entry.fields?.runId === runId && entry.fields?.holderPid === process.pid)).toBe(true)
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

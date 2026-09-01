import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  type ManagedChildEvent,
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RunnerOutcome,
} from "@oh-my-opencode/senpi-task"

import {
  createDagFileStore,
  createDagManager,
  type DagRunEvent,
  type DagRunId,
  type DagRunRecordV1,
} from "@oh-my-opencode/senpi-task/dag"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { runDagTool } from "./dag-tool"
import { composeTaskEngine, type TaskRunnerFactories } from "./engine"
import type { CapturedUi } from "./runtime-context"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function within<T>(promise: Promise<T>, ms = 300): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

class ScriptedRunner implements ManagedRunner {
  readonly handles: Array<{
    readonly spec: ManagedStartSpec
    readonly emit: (event: ManagedChildEvent) => void
    readonly listenerCount: () => number
    readonly settle: (output: string) => void
    readonly disposed: Promise<void>
    readonly fail: (message: string) => void
  }> = []
  readonly #signals = new Map<number, ReturnType<typeof deferred<void>>>()
  readonly #abortError: Error | undefined
  abortCalls = 0
  disposeCalls = 0

  constructor(abortError?: Error) {
    this.#abortError = abortError
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const outcome = deferred<RunnerOutcome>()
    const disposed = deferred<void>()
    const listeners = new Set<(event: ManagedChildEvent) => void>()
    const handle: ManagedChildHandle = {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => {
        this.abortCalls += 1
        outcome.resolve({ status: "cancelled" })
        if (this.#abortError !== undefined) queueMicrotask(() => { void Promise.reject(this.#abortError) })
        return Promise.resolve()
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      waitForOutcome: () => outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => {
        this.disposeCalls += 1
        disposed.resolve()
        return Promise.resolve()
      },
    }
    this.handles.push({
      spec,
      emit: (event) => {
        for (const listener of listeners) listener(event)
      },
      listenerCount: () => listeners.size,
      settle: (output) => outcome.resolve({ status: "completed", finalResponse: output }),
      disposed: disposed.promise,
      fail: (message) => outcome.resolve({ status: "error", failure: { kind: "child-turn-failed", message } }),
    })
    this.#signals.get(this.handles.length)?.resolve()
    return Promise.resolve(handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.handles.length >= count) return Promise.resolve()
    const signal = this.#signals.get(count) ?? deferred<void>()
    this.#signals.set(count, signal)
    return signal.promise
  }
}

class ManualTimers {
  readonly #timers = new Map<number, { readonly callback: () => void; readonly ms: number }>()
  #next = 0

  set(callback: () => void, ms: number): number {
    this.#next += 1
    this.#timers.set(this.#next, { callback, ms })
    return this.#next
  }

  clear(handle: ReturnType<typeof setTimeout> | number): void {
    if (typeof handle === "number") this.#timers.delete(handle)
  }

  flush(ms: number): void {
    const selected = [...this.#timers].filter(([, timer]) => timer.ms === ms)
    for (const [handle, timer] of selected) {
      this.#timers.delete(handle)
      timer.callback()
    }
  }
}

function logger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}

function dagStore(cwd: string) {
  return createDagFileStore({ project_dir: cwd })
}

async function seedPendingRun(cwd: string, runId: DagRunId, sessionId: string): Promise<void> {
  await createDagManager({ store: dagStore(cwd), newRunId: () => runId }).start({
    parentSessionId: sessionId,
    rootSessionId: sessionId,
    definition: {
      key: `recovery-${runId}`,
      name: "adapter recovery",
      nodes: [{ id: "resume", prompt: "resume", subagent_type: "explore", model: "omo-mock/mock-1" }],
    },
  })
}

function dagEvents(cwd: string, runId: DagRunId): readonly DagRunEvent[] {
  return dagStore(cwd).readEvents(runId, 0, { limit: 100 }).events
}

function pauseForShutdown(runtime: ReturnType<typeof createDagRuntime>): void {
  expect("pauseForShutdown" in runtime).toBe(true)
  if (!("pauseForShutdown" in runtime) || typeof runtime.pauseForShutdown !== "function") return
  runtime.pauseForShutdown()
}

function fakeUi(widgetRows: string[][]): CapturedUi {
  return {
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (key, rows) => {
      if (key === "omo-dag" && rows !== undefined) widgetRows.push(rows)
    },
    select: async () => undefined,
    confirm: async () => false,
  }
}

describe("assembled DAG runtime", () => {
  test("#given a running DAG node #when its assembled child emits progress #then RPC and the live widget share one activity subscription that tears down", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-activity-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const rpcEvents: Array<{ readonly name: string; readonly data: unknown }> = []
    const taskAttached = deferred<void>()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: {
        emit: (name: string, data: unknown) => {
          rpcEvents.push({ name, data })
          if (name === "omo.dag.event" && typeof data === "object" && data !== null &&
            "type" in data && data.type === "dag.node.task-attached") taskAttached.resolve()
        },
        handle: () => undefined,
      },
    })
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    const widgetRows: string[][] = []
    engine.runtime.captureFrom({
      mode: "tui",
      ui: fakeUi(widgetRows),
      sessionManager: { getSessionId: () => "session-activity" },
    })
    const bridgeTimers = new ManualTimers()
    const statusUiTimers = new ManualTimers()
    const runtime = createDagRuntime({ pi, engine, logger: logger(), bridgeTimers, statusUiTimers })
    await runtime.attach()

    // when
    const started = await runtime.manager.start({
      parentSessionId: "session-activity",
      rootSessionId: "session-activity",
      definition: {
        key: "assembled-activity",
        name: "assembled activity",
        nodes: [{ id: "active", prompt: "work", subagent_type: "explore", model: "omo-mock/mock-1" }],
      },
    })
    await within(runner.whenStarted(1))
    await within(taskAttached.promise)
    const attachedListenerCount = runner.handles[0]?.listenerCount() ?? 0
    expect(attachedListenerCount).toBeGreaterThan(0)
    await runtime.attach()
    expect(runner.handles[0]?.listenerCount()).toBe(attachedListenerCount)
    runner.handles[0]?.emit({ type: "tool_execution_start", toolName: "read", args: { path: "src/live.ts" } })
    bridgeTimers.flush(150)
    statusUiTimers.flush(1_000)

    // then
    expect(rpcEvents.filter((event) => event.name === "omo.dag.activity")).toEqual([
      {
        name: "omo.dag.activity",
        data: expect.objectContaining({
          schemaVersion: 1,
          runId: started.snapshot.runId,
          nodeId: "active",
          taskId: runner.handles[0]?.spec.taskId,
          activity: expect.stringContaining("read src/live.ts"),
          currentTool: "read src/live.ts",
          turns: 0,
        }),
      },
    ])
    expect(widgetRows).toEqual(expect.arrayContaining([
      expect.arrayContaining([expect.stringContaining("read src/live.ts")]),
    ]))
    runner.handles[0]?.settle("done")
    await within(runtime.wait(started.snapshot.runId, "session-activity"))
    expect(runner.handles[0]?.listenerCount()).toBe(attachedListenerCount - 1)
    await runtime.attach()
    expect(runner.handles[0]?.listenerCount()).toBe(attachedListenerCount - 1)
    runtime.dispose()
  }, { timeout: 15_000 })

  test("#given an unknown node skill #when the assembled runtime creates the run #then snapshot records missing_skill and dispatch keeps the prompt", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-missing-skill-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const pi = new FakeExtensionAPI()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "session-missing-skill" } })
    const runtime = createDagRuntime({ pi, engine, logger: logger() })
    await runtime.attach()

    // when
    const started = await runtime.manager.start({
      parentSessionId: "session-missing-skill",
      rootSessionId: "session-missing-skill",
      definition: {
        key: "assembled-missing-skill",
        name: "assembled missing skill",
        nodes: [{
          id: "missing",
          prompt: "original prompt",
          load_skills: ["definitely-not-a-real-skill-f3"],
          subagent_type: "explore",
          model: "omo-mock/mock-1",
        }],
      },
    })
    await within(runner.whenStarted(1))
    const snapshot = runtime.manager.snapshot(started.snapshot.runId, "session-missing-skill")

    // then
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      kind: "missing_skill",
      nodeId: "missing",
      skill: "definitely-not-a-real-skill-f3",
    }))
    expect(runner.handles[0]?.spec.prompt).toBe("original prompt")
    runner.handles[0]?.settle("done")
    await within(runtime.wait(started.snapshot.runId, "session-missing-skill"))
    runtime.dispose()
  })

  test("#given a terminal wake buffered during compaction #when the assembled runtime attaches on session start #then it redelivers exactly once", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-wake-redelivery-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const deliveries: string[] = []
    const coordinator = new IdleInjectionCoordinator((message) => { deliveries.push(message.content) })
    const pi = new FakeExtensionAPI()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
      coordinator,
    })
    engine.runtime.captureFrom({
      isIdle: () => false,
      sessionManager: { getSessionId: () => "session-wake-redelivery" },
    })
    const runtime = createDagRuntime({ pi, engine, logger: logger(), coordinator })
    await runtime.attach()
    engine.runtime.setTransition("compacting")
    const started = await runtime.manager.start({
      parentSessionId: "session-wake-redelivery",
      rootSessionId: "session-wake-redelivery",
      definition: {
        key: "assembled-wake-redelivery",
        name: "assembled wake redelivery",
        nodes: [{ id: "complete", prompt: "complete", subagent_type: "explore", model: "omo-mock/mock-1" }],
      },
    })
    await within(runner.whenStarted(1))
    runner.handles[0]?.settle("done")
    await within(runtime.wait(started.snapshot.runId, "session-wake-redelivery"))
    expect(coordinator.pendingCount()).toBe(0)
    expect(deliveries).toEqual([])

    // when
    engine.runtime.setTransition(undefined)
    engine.runtime.captureFrom({ isIdle: () => true })
    await runtime.attach()
    await Promise.resolve()
    await runtime.attach()
    await Promise.resolve()

    // then
    expect(deliveries).toEqual([
      expect.stringContaining("DAG \"assembled wake redelivery\" completed"),
    ])
    expect(coordinator.pendingCount()).toBe(0)
    runtime.dispose()
  }, { timeout: 15_000 })

  test("#given a live task component runtime #when a two-node dag runs #then scheduler, artifacts, rpc, widget, and one wake all observe the same run", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-runtime-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const runnerFactories: TaskRunnerFactories = {
      inProcess: () => runner,
      process: () => runner,
    }
    const rpcEvents: Array<{ readonly name: string; readonly data: unknown }> = []
    const rpcHandlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: {
        emit: (name: string, data: unknown) => rpcEvents.push({ name, data }),
        handle: (name: string, handler: (data: unknown) => unknown | Promise<unknown>) => rpcHandlers.set(name, handler),
      },
    })
    const wakeDeliveries: string[] = []
    const coordinator = new IdleInjectionCoordinator((message) => { wakeDeliveries.push(message.content) })
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories,
      coordinator,
    })
    const widgetRows: string[][] = []
    engine.runtime.captureFrom({
      mode: "tui",
      ui: fakeUi(widgetRows),
      sessionManager: { getSessionId: () => "session-dag" },
    })
    const bridgeTimers = new ManualTimers()
    const statusUiTimers = new ManualTimers()
    const runtime = createDagRuntime({ pi, engine, logger: logger(), coordinator, bridgeTimers, statusUiTimers })
    runtime.attach()

    // when
    const started = await runDagTool(
      {
        manager: runtime.manager,
        parentSessionId: () => "session-dag",
        rootSessionId: () => "session-dag",
        wait: runtime.wait,
        cancel: runtime.cancel,
      },
      {
        action: "start",
        definition: {
          key: "assembled-two-node",
          name: "assembled two node",
          nodes: [
            { id: "plan", prompt: "plan", subagent_type: "explore", model: "omo-mock/mock-1" },
            { id: "build", prompt: "build", subagent_type: "explore", model: "omo-mock/mock-1", dependsOn: ["plan"] },
          ],
        },
      },
    )
    if (started.details.kind !== "started") throw new Error("expected dag start")
    const runId = started.details.run_id as DagRunId
    await runner.whenStarted(1)
    bridgeTimers.flush(50)
    statusUiTimers.flush(250)
    runner.handles[0]?.settle("plan output")
    await runner.whenStarted(2)
    runner.handles[1]?.settle("build output")
    const result = await runtime.wait(runId, "session-dag")
    bridgeTimers.flush(50)
    await Promise.resolve()

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.plan).toEqual(expect.objectContaining({ state: "completed", output: "plan output" }))
    expect(result.nodes.build).toEqual(expect.objectContaining({ state: "completed", output: "build output" }))
    expect(fs.readFileSync(join(engine.stateDir, "dag", "results", runId, "plan.txt"), "utf8")).toBe("plan output")
    expect(fs.readFileSync(join(engine.stateDir, "dag", "results", runId, "build.txt"), "utf8")).toBe("build output")
    const persisted = runtime.manager.record(runId, "session-dag") as unknown as {
      readonly nodes: readonly { readonly id: string; readonly resultArtifact?: { readonly sha256: string; readonly bytes: number } }[]
    }
    expect(persisted.nodes.every((node) => node.resultArtifact !== undefined)).toBe(true)
    expect(rpcEvents.some((event) => event.name === "omo.dag.event")).toBe(true)
    expect(rpcEvents.some((event) => event.name === "omo.dag.updated")).toBe(true)
    expect(widgetRows.some((rows) => rows.some((row) => row.includes("assembled two node")))).toBe(true)
    expect(wakeDeliveries).toHaveLength(1)
    expect(wakeDeliveries[0]).toContain("DAG \"assembled two node\" completed")
    expect(rpcHandlers.has("omo.dag.snapshot")).toBe(true)

    const cancellable = await runDagTool(
      {
        manager: runtime.manager,
        parentSessionId: () => "session-dag",
        rootSessionId: () => "session-dag",
        wait: runtime.wait,
        cancel: runtime.cancel,
      },
      {
        action: "start",
        definition: {
          key: "assembled-cancel",
          name: "assembled cancel",
          nodes: [
            { id: "hold", prompt: "hold", subagent_type: "explore", model: "omo-mock/mock-1" },
            { id: "never", prompt: "never", subagent_type: "explore", model: "omo-mock/mock-1", dependsOn: ["hold"] },
          ],
        },
      },
    )
    if (cancellable.details.kind !== "started") throw new Error("expected cancellable dag start")
    await runner.whenStarted(3)
    const cancelled = await runDagTool(
      {
        manager: runtime.manager,
        parentSessionId: () => "session-dag",
        rootSessionId: () => "session-dag",
        wait: runtime.wait,
        cancel: runtime.cancel,
      },
      { action: "cancel", run_id: cancellable.details.run_id, reason: "stop proof" },
    )
    if (cancelled.details.kind !== "cancelled") throw new Error("expected dag cancellation")
    expect(cancelled.details.snapshot.status).toBe("cancelled")
    expect(runner.handles).toHaveLength(3)

    const resultsDir = join(engine.stateDir, "dag", "results")
    const copyFailure = await runDagTool(
      {
        manager: runtime.manager,
        parentSessionId: () => "session-dag",
        rootSessionId: () => "session-dag",
        wait: runtime.wait,
        cancel: runtime.cancel,
      },
      {
        action: "start",
        definition: {
          key: "assembled-copy-failure",
          name: "assembled copy failure",
          nodes: [{ id: "copy", prompt: "copy", subagent_type: "explore", model: "omo-mock/mock-1" }],
        },
      },
    )
    if (copyFailure.details.kind !== "started") throw new Error("expected copy-failure dag start")
    await runner.whenStarted(4)
    runner.handles[3]?.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "blocked output" }],
        usage: { output: 2, totalTokens: 3 },
      },
    })
    const blockedStatsPath = join(resultsDir, copyFailure.details.run_id, "copy.stats.json")
    // A directory at the sidecar file path rejects open-for-write on Windows and POSIX while leaving the copied output readable.
    fs.mkdirSync(blockedStatsPath, { recursive: true })
    expect(fs.statSync(blockedStatsPath).isDirectory()).toBe(true)
    runner.handles[3]?.settle("blocked output")
    await runtime.wait(copyFailure.details.run_id as DagRunId, "session-dag")
    fs.rmSync(blockedStatsPath, { recursive: true })
    const failedCopyRecord = runtime.manager.record(copyFailure.details.run_id as DagRunId, "session-dag") as unknown as {
      readonly diagnostics: readonly { readonly kind: string }[]
    }
    expect(failedCopyRecord.diagnostics.some((diagnostic) => diagnostic.kind === "journal_corrupt")).toBe(true)
  }, { timeout: 15_000 })

  test("#given a live-shaped in-process child whose abort rejects #when the assembled runtime cancels #then no unhandled rejection escapes and a later run still completes", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-abort-boundary-"))
    cleanupRoots.push(cwd)
    const abortError = new DOMException("This operation was aborted", "AbortError")
    const runner = new ScriptedRunner(abortError)
    const pi = new FakeExtensionAPI()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    const sessionId = "session-abort-boundary"
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const runtime = createDagRuntime({ pi, engine, logger: logger() })
    await runtime.attach()
    const started = await runtime.manager.start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: {
        key: "abort-boundary",
        name: "abort boundary",
        nodes: [{ id: "active", prompt: "active", subagent_type: "explore", model: "omo-mock/mock-1" }],
      },
    })
    await within(runner.whenStarted(1))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on("unhandledRejection", onUnhandled)

    try {
      // when
      await runtime.cancel(started.snapshot.runId, "live cancel")
      const cancelled = await runtime.wait(started.snapshot.runId, sessionId)
      const survivor = await runtime.manager.start({
        parentSessionId: sessionId,
        rootSessionId: sessionId,
        definition: {
          key: "after-abort-boundary",
          name: "after abort boundary",
          nodes: [{ id: "survivor", prompt: "survive", subagent_type: "explore", model: "omo-mock/mock-1" }],
        },
      })
      await within(runner.whenStarted(2))
      runner.handles[1]?.settle("runtime survived")
      const survived = await within(runtime.wait(survivor.snapshot.runId, sessionId))

      // then
      expect(cancelled.status).toBe("cancelled")
      expect(runner.abortCalls).toBe(0)
      expect(runner.disposeCalls).toBe(0)
      expect(survived.status).toBe("completed")
      expect(survived.nodes.survivor).toEqual(expect.objectContaining({ output: "runtime survived" }))
      expect(unhandled).toEqual([])
      runner.handles[0]?.settle("cancelled child reached its natural boundary")
      const disposed = runner.handles[0]?.disposed
      if (disposed === undefined) throw new Error("cancelled child handle was not retained")
      await within(disposed)
      expect(runner.disposeCalls).toBe(1)
    } finally {
      process.off("unhandledRejection", onUnhandled)
      runtime.dispose()
    }
  })

  test("#given an active run #when detach switches sessions before its task settles #then the old scheduler terminates without resolving ownership against the new session", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-detach-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const pi = new FakeExtensionAPI()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "session-old" } })
    const errors: string[] = []
    const runtime = createDagRuntime({
      pi,
      engine,
      logger: { info: () => undefined, warn: () => undefined, error: (message) => errors.push(message) },
    })
    await runtime.attach()
    const started = await runtime.manager.start({
      parentSessionId: "session-old",
      rootSessionId: "session-old",
      definition: {
        key: "detach-running",
        name: "detach running",
        nodes: [{ id: "active", prompt: "active", subagent_type: "explore", model: "omo-mock/mock-1" }],
      },
    })
    const runId = started.snapshot.runId
    await within(runner.whenStarted(1))
    const waiting = runtime.wait(runId, "session-old")

    // when
    runtime.detach()
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "session-new" } })
    await runtime.attach()
    runner.handles[0]?.settle("late output")
    const result = await within(waiting)

    // then
    expect(result.status).toBe("cancelled")
    expect(errors).toEqual([])
    runtime.dispose()
  })

  test("#given a throwing durable-event subscriber #when a run publishes checkpoints #then the scheduler and other subscribers still reach completion", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-subscriber-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: {
        emit: (name: string) => {
          if (name === "omo.dag.event") throw new Error("subscriber exploded")
        },
        handle: () => undefined,
      },
    })
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "session-subscriber" } })
    const runtime = createDagRuntime({ pi, engine, logger: logger() })
    await runtime.attach()

    // when
    const started = await runtime.manager.start({
      parentSessionId: "session-subscriber",
      rootSessionId: "session-subscriber",
      definition: {
        key: "throwing-subscriber",
        name: "throwing subscriber",
        nodes: [{ id: "survivor", prompt: "survive", subagent_type: "explore", model: "omo-mock/mock-1" }],
      },
    })
    const runId = started.snapshot.runId
    const waiting = runtime.wait(runId, "session-subscriber")
    await within(runner.whenStarted(1))
    runner.handles[0]?.settle("survived")
    const result = await within(waiting)

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.survivor).toEqual(expect.objectContaining({ state: "completed", output: "survived" }))
    runtime.dispose()
  })

  test("#given a live adapter DAG #when shutdown pauses it and a later adapter starts #then the paused event is durable and the run is claimed, resumed, and completed", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-recovery-"))
    cleanupRoots.push(cwd)
    const runId = "dag-adapter-recovery" as DagRunId
    const sessionId = "session-recovery"
    await seedPendingRun(cwd, runId, sessionId)
    const firstPi = new FakeExtensionAPI()
    const firstEngine = composeTaskEngine({
      pi: firstPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => new ScriptedRunner(), process: () => new ScriptedRunner() },
    })
    firstEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const firstRuntime = createDagRuntime({ pi: firstPi, engine: firstEngine, logger: logger() })

    // when
    pauseForShutdown(firstRuntime)
    firstRuntime.dispose()

    // then
    const pausedStore = dagStore(cwd)
    const paused = pausedStore.readCheckpoint<DagRunRecordV1 & { readonly previousLeaseHolderPid?: number }>(runId)
    expect(paused?.status).toBe("paused")
    expect(dagEvents(cwd, runId).at(-1)).toEqual(expect.objectContaining({
      type: "dag.run.paused",
      reason: "session_shutdown",
    }))

    // given a subsequent host process whose predecessor PID is dead
    if (paused === null) throw new Error("expected paused adapter run")
    pausedStore.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: 2_147_483_647 })
    const resumedRunner = new ScriptedRunner()
    const resumedPi = new FakeExtensionAPI()
    const resumedEngine = composeTaskEngine({
      pi: resumedPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => resumedRunner, process: () => resumedRunner },
    })
    resumedEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const resumedRuntime = createDagRuntime({ pi: resumedPi, engine: resumedEngine, logger: logger() })

    // when
    const attached = resumedRuntime.attach()
    await resumedRunner.whenStarted(1)
    resumedRunner.handles[0]?.settle("resumed output")
    await attached
    const result = await resumedRuntime.wait(runId, sessionId)

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.resume).toEqual(expect.objectContaining({ state: "completed", output: "resumed output" }))
    expect(dagEvents(cwd, runId).some((event) => event.type === "dag.run.resumed")).toBe(true)
    resumedRuntime.dispose()
  })

  test("#given a paused run and a non-default subscriber ring #when the assembled runtime resumes it #then the overflow is journaled and shipped RPC receives the recovered snapshot", async () => {
    // given - the bridge attaches AFTER recovery (#7316), so recovery-window events are never
    // pushed live; the overflow marker must be durable in the journal for history-paging viewers,
    // and RPC's first wholesale snapshot must already carry the recovered run.
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-recovery-ring-"))
    cleanupRoots.push(cwd)
    const runId = "dag-adapter-recovery-ring" as DagRunId
    const sessionId = "session-recovery-ring"
    await seedPendingRun(cwd, runId, sessionId)
    const store = dagStore(cwd)
    const pending = store.readCheckpoint<DagRunRecordV1>(runId)
    if (pending === null) throw new Error("expected pending recovery-ring run")
    store.writeCheckpoint(runId, {
      ...pending,
      status: "paused",
      previousLeaseHolderPid: 2_147_483_647,
    })
    const runner = new ScriptedRunner()
    const recoveredSnapshot = deferred<{ readonly status?: string }>()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: {
        emit: (name: string, data: unknown) => {
          if (name !== "omo.dag.updated" || typeof data !== "object" || data === null) return
          const payload = data as { readonly runs?: ReadonlyArray<{ readonly run_id?: string; readonly status?: string }> }
          const run = payload.runs?.find((entry) => entry.run_id === runId)
          if (run !== undefined) recoveredSnapshot.resolve(run)
        },
        handle: () => undefined,
      },
    })
    const baseConfig = loadOmoConfig({ cwd }).config
    const engine = composeTaskEngine({
      pi,
      omoConfig: {
        ...baseConfig,
        task: OmoTaskSettingsSchema.parse({ dag: { subscriber_ring: 1 } }),
      },
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const runtime = createDagRuntime({ pi, engine, logger: logger() })

    // when
    const attaching = runtime.attach()
    await within(runner.whenStarted(1))
    runner.handles[0]?.settle("resumed through configured ring")
    await within(attaching)
    const delivered = await within(recoveredSnapshot.promise)

    // then the overflow survived durably for history paging, and the pushed snapshot is recovered
    const journaled = dagEvents(cwd, runId).find(
      (event): event is Extract<DagRunEvent, { type: "dag.stream.overflow" }> => event.type === "dag.stream.overflow",
    )
    expect(journaled).toBeDefined()
    expect(journaled?.droppedCount).toBeGreaterThan(0)
    expect(journaled?.recoverAfterSeq).toBeGreaterThanOrEqual(0)
    expect(delivered.status).toBe("completed")
    expect(runtime.manager.snapshot(runId, sessionId).status).toBe("completed")
    runtime.dispose()
  })

  test("#given a paused adapter DAG whose lease holder PID is still live #when another adapter starts #then it never claims or resumes the run", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-live-lease-"))
    cleanupRoots.push(cwd)
    const runId = "dag-adapter-live-lease" as DagRunId
    const sessionId = "session-live-lease"
    await seedPendingRun(cwd, runId, sessionId)
    const firstPi = new FakeExtensionAPI()
    const firstEngine = composeTaskEngine({
      pi: firstPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
    })
    firstEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const firstRuntime = createDagRuntime({ pi: firstPi, engine: firstEngine, logger: logger() })
    pauseForShutdown(firstRuntime)

    const secondPi = new FakeExtensionAPI()
    const secondEngine = composeTaskEngine({
      pi: secondPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
    })
    secondEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const secondRuntime = createDagRuntime({ pi: secondPi, engine: secondEngine, logger: logger() })

    // when
    await secondRuntime.attach()

    // then
    expect(secondRuntime.manager.record(runId, sessionId).status).toBe("paused")
    expect(dagEvents(cwd, runId).some((event) => event.type === "dag.run.resumed")).toBe(false)
    secondRuntime.dispose()
  })
})

describe("dag runtime node spawn policy", () => {
  test("#given a runtime with a denying node spawn policy #when an agent-routed node is admitted #then the node fails with the denial and no child starts", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-runtime-policy-"))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    const runnerFactories: TaskRunnerFactories = {
      inProcess: () => runner,
      process: () => runner,
    }
    const pi = new FakeExtensionAPI()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories,
    })
    engine.runtime.captureFrom({
      mode: "tui",
      ui: fakeUi([]),
      sessionManager: { getSessionId: () => "session-dag" },
    })
    const runtime = createDagRuntime({
      pi,
      engine,
      logger: logger(),
      nodeSpawnPolicy: () => ({ kind: "deny", message: "momus requires a plan gate" }),
    })
    runtime.attach()

    // when
    const started = await runDagTool(
      {
        manager: runtime.manager,
        parentSessionId: () => "session-dag",
        rootSessionId: () => "session-dag",
        wait: runtime.wait,
        cancel: runtime.cancel,
      },
      {
        action: "start",
        definition: {
          key: "policy-denied",
          name: "policy denied",
          nodes: [{ id: "review", prompt: "review the plan", subagent_type: "momus", model: "omo-mock/mock-1" }],
        },
      },
    )
    if (started.details.kind !== "started") throw new Error("expected dag start")
    const result = await runtime.wait(started.details.run_id as DagRunId, "session-dag")

    // then
    expect(result.status).toBe("failed")
    const review = result.nodes.review
    if (review?.state !== "failed") throw new Error("expected the denied node to fail")
    expect(review.error.message).toContain("momus requires a plan gate")
    expect(runner.handles).toHaveLength(0)
    runtime.dispose()
  })
})

describe("assembled DAG runtime control verbs", () => {
  async function controlFixture(name: string, nodes: readonly { readonly id: string; readonly dependsOn?: readonly string[] }[]) {
    const cwd = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-${name}-`))
    cleanupRoots.push(cwd)
    const runner = new ScriptedRunner()
    // Node-level synchronization: every control verb reads the DURABLE record, so the tests wait on
    // the journaled node event rather than on a runner counter that runs ahead of the checkpoint.
    const nodeEvents: Array<{ readonly type: string; readonly nodeId?: string; readonly to?: string }> = []
    const nodeWaiters = new Set<() => void>()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: {
        emit: (channel: string, data: unknown) => {
          if (channel !== "omo.dag.event") return
          nodeEvents.push(data as { readonly type: string; readonly nodeId?: string; readonly to?: string })
          for (const waiter of [...nodeWaiters]) waiter()
        },
        handle: () => undefined,
      },
    })
    const whenNode = (nodeId: string, predicate: (event: { readonly type: string; readonly nodeId?: string; readonly to?: string }) => boolean): Promise<void> => {
      const satisfied = () => nodeEvents.some((event) => event.nodeId === nodeId && predicate(event))
      if (satisfied()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const waiter = (): void => {
          if (!satisfied()) return
          nodeWaiters.delete(waiter)
          resolve()
        }
        nodeWaiters.add(waiter)
      })
    }
    const whenAttached = (nodeId: string) => whenNode(nodeId, (event) => event.type === "dag.node.task-attached")
    const whenState = (nodeId: string, state: string) =>
      whenNode(nodeId, (event) => event.type === "dag.node.transitioned" && event.to === state)
    const sessionId = `session-${name}`
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => sessionId } })
    const runtime = createDagRuntime({ pi, engine, logger: logger() })
    await runtime.attach()
    const tool = {
      manager: runtime.manager,
      parentSessionId: () => sessionId,
      rootSessionId: () => sessionId,
      wait: runtime.wait,
      cancel: runtime.cancel,
      retry: runtime.retry,
      send: runtime.send,
      amend: runtime.amend,
    }
    const started = await runDagTool(tool, {
      action: "start",
      definition: {
        key: name,
        name,
        nodes: nodes.map((node) => ({
          id: node.id,
          prompt: `do ${node.id}`,
          subagent_type: "explore",
          model: "omo-mock/mock-1",
          ...(node.dependsOn === undefined ? {} : { dependsOn: [...node.dependsOn] }),
        })),
      },
    })
    if (started.details.kind !== "started") throw new Error("expected dag start")
    return { cwd, runner, runtime, tool, sessionId, whenAttached, whenState, runId: started.details.run_id as DagRunId }
  }

  test("#given a failed node #when the runtime retry entry point runs #then a fresh scheduler re-registers and the run completes", async () => {
    // given
    const { runner, runtime, sessionId, runId } = await controlFixture("retry-reentry", [
      { id: "plan" },
      { id: "build", dependsOn: ["plan"] },
    ])
    await within(runner.whenStarted(1))
    runner.handles[0]?.fail("plan blew up")
    const failed = await within(runtime.wait(runId, sessionId), 5_000)
    expect(failed.status).toBe("failed")

    // when
    const retried = await within(runtime.retry(runId), 5_000)
    await within(runner.whenStarted(2), 5_000)
    runner.handles[1]?.settle("plan retried")
    await within(runner.whenStarted(3), 5_000)
    runner.handles[2]?.settle("build output")
    const result = await within(runtime.wait(runId, sessionId), 5_000)

    // then
    expect(retried.status).toBe("running")
    expect(result.status).toBe("completed")
    expect(result.nodes.plan).toEqual(expect.objectContaining({ state: "completed", output: "plan retried" }))
    expect(result.nodes.build).toEqual(expect.objectContaining({ state: "completed", output: "build output" }))
    runtime.dispose()
  }, { timeout: 20_000 })

  test("#given a run paused for shutdown and resumed in the SAME process #when a node is retried #then admission is un-latched and the retry completes", async () => {
    // given
    const { runner, runtime, sessionId, runId, whenAttached, whenState } = await controlFixture("retry-after-pause", [
      { id: "solo" },
      { id: "next", dependsOn: ["solo"] },
    ])
    await within(runner.whenStarted(1))
    await within(whenAttached("solo"), 5_000)
    // pausing a RUNNING run is the ONLY thing that latches admission, and nothing ever un-latches it
    runtime.pauseForShutdown()
    await within(runtime.attach(), 5_000)
    runner.handles[0]?.fail("solo blew up")
    await within(whenState("solo", "failed"), 5_000)
    const failed = await within(runtime.wait(runId, sessionId), 5_000)
    expect(failed.status).toBe("failed")

    // when the stoppedAdmissions latch is NOT cleared, this retry hangs forever
    await within(runtime.retry(runId), 5_000)
    await within(runner.whenStarted(2), 5_000)
    runner.handles[1]?.settle("solo retried")
    await within(runner.whenStarted(3), 5_000)
    runner.handles[2]?.settle("next output")
    const result = await within(runtime.wait(runId, sessionId), 5_000)

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.solo).toEqual(expect.objectContaining({ state: "completed", output: "solo retried" }))
    expect(result.nodes.next).toEqual(expect.objectContaining({ state: "completed", output: "next output" }))
    runtime.dispose()
  }, { timeout: 20_000 })

  test("#given a run resumed by retry #when attach re-runs the schedulable gate #then the re-registered scheduler is reused instead of a second one starting the node twice", async () => {
    // given
    const { runner, runtime, sessionId, runId, whenAttached } = await controlFixture("retry-registration", [{ id: "solo" }])
    await within(runner.whenStarted(1))
    runner.handles[0]?.fail("solo blew up")
    await within(runtime.wait(runId, sessionId), 5_000)
    const resumed = await within(runtime.retry(runId), 5_000)
    await within(whenAttached("solo"), 5_000)
    const childrenAfterRetry = runner.handles.length

    // when the resumed run passes back through the schedulable-status gate
    await within(runtime.attach(), 5_000)
    await within(runtime.attach(), 5_000)

    // then no second scheduler admitted the node again
    expect(resumed.status).toBe("running")
    expect(runner.handles).toHaveLength(childrenAfterRetry)
    runner.handles[childrenAfterRetry - 1]?.settle("solo retried")
    const result = await within(runtime.wait(runId, sessionId), 5_000)
    expect(result.status).toBe("completed")
    runtime.dispose()
  }, { timeout: 20_000 })

  test("#given a running node #when the runtime send entry point runs #then the message is steered to its child", async () => {
    // given
    const { runner, runtime, sessionId, runId, whenAttached } = await controlFixture("send-steer", [{ id: "live" }])
    await within(runner.whenStarted(1))
    await within(whenAttached("live"), 5_000)

    // when
    const sent = await within(runtime.send(runId, "live", "focus on the failing test"), 5_000)

    // then
    expect(sent.delivery).toBe("steer")
    expect(String(sent.nodeId)).toBe("live")
    expect(sent.taskId).toBe(runner.handles[0]?.spec.taskId)
    runner.handles[0]?.settle("done")
    await within(runtime.wait(runId, sessionId), 5_000)
    runtime.dispose()
  }, { timeout: 20_000 })

  test("#given a settled run #when the runtime amend entry point edits a node #then only the changed node re-runs and the run re-enters", async () => {
    // given
    const { runner, runtime, sessionId, runId } = await controlFixture("amend-reentry", [
      { id: "plan" },
      { id: "build", dependsOn: ["plan"] },
    ])
    await within(runner.whenStarted(1))
    runner.handles[0]?.settle("plan output")
    await within(runner.whenStarted(2), 5_000)
    runner.handles[1]?.fail("build blew up")
    const failed = await within(runtime.wait(runId, sessionId), 5_000)
    expect(failed.status).toBe("failed")
    const planTaskId = runtime.manager.record(runId, sessionId).nodes.find((node) => String(node.id) === "plan")?.taskId

    // when
    await within(runtime.amend(runId, {
      key: "amend-reentry",
      name: "amend-reentry",
      nodes: [
        { id: "plan", prompt: "do plan", subagent_type: "explore", model: "omo-mock/mock-1" },
        { id: "build", prompt: "do build CAREFULLY", subagent_type: "explore", model: "omo-mock/mock-1", dependsOn: ["plan"] },
      ],
    }), 5_000)
    await within(runner.whenStarted(3), 5_000)
    runner.handles[2]?.settle("build amended")
    const result = await within(runtime.wait(runId, sessionId), 5_000)

    // then
    expect(result.status).toBe("completed")
    expect(runner.handles).toHaveLength(3)
    expect(result.nodes.build).toEqual(expect.objectContaining({ state: "completed", output: "build amended" }))
    expect(runtime.manager.record(runId, sessionId).nodes.find((node) => String(node.id) === "plan")?.taskId).toBe(planTaskId)
    runtime.dispose()
  }, { timeout: 20_000 })
})

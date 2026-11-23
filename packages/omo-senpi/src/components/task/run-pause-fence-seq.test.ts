import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "../../senpi-test-runtime"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import type { RunnerOutcome } from "../../../../senpi-task/src/manager/child-handle"
import {
  baseSpec,
  categoryPlanner,
  cleanupProjects,
  FakeRunner,
  settings,
  tempProject,
} from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { RELEASE_RUN_FENCE, type EnginePauseState, type RunRef } from "../../../../senpi-task/src/pause/ports"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { remainingTestTime, useTestTimeout } from "../../../../../test-support/test-deadline"
import { createEngineRunPause } from "./engine-run-pause"
import { isRunHoldChange } from "./run-pause-bridge"
import { TaskRuntimeContext, type LiveTaskContext } from "./runtime-context"

const roots: string[] = []
afterEach(() => {
  cleanupProjects()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makePauseHarness() {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const turn = Promise.withResolvers<RunnerOutcome>()
  const pausedOwners: number[] = []
  const resumedOwners: number[] = []
  const manager = createTaskManager({
    cwd,
    store,
    config: settings({ provider_concurrency: { anthropic: 4 } }),
    planner: categoryPlanner(),
    admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childPausePort: {
      pauseForRun: async (child, owner) => {
        pausedOwners.push(owner.parentPauseSeq)
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 8 }
      },
      resumeTurn: async (_child, request) => {
        resumedOwners.push(request.parentPauseSeq)
        return { turnId: "fresh-turn", outcome: turn.promise }
      },
      holdInput: async () => ({ kind: "held", entryId: "guidance", duplicate: false }),
    },
  })
  return { cwd, store, barrier, runner, turn, pausedOwners, resumedOwners, manager }
}

test("reloading or reopening a resumed session whose prior Stop installed run fences keeps admission open and adds no fences", async () => {
  const h = makePauseHarness()
  const first = await h.manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (first.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = {
    pauseSeq: 7,
    holds: [{ kind: "session_hold", key: "session_hold:7", data: { localSeq: 7 } }],
  }
  const runtime = {
    getPauseState: () => state,
    fenceRun: (ref: RunRef) => {
      state = {
        pauseSeq: state.pauseSeq + 1,
        holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}`, data: { runRef: ref } }],
      }
    },
    [RELEASE_RUN_FENCE]: (ref: RunRef) => {
      const key = `run_fence:${ref.kind}:${ref.id}`
      state = { ...state, holds: state.holds.filter((hold) => hold.key !== key) }
    },
  }
  let dagQuiesceCount = 0
  const registerDag = (pause: ReturnType<typeof createEngineRunPause>) =>
    pause.register({
      refs: () => [{ kind: "dag", id: "dag_1" }],
      quiesce: () => {
        dagQuiesceCount += 1
      },
    })
  const before = createEngineRunPause({
    stateDir: h.store.stateDir,
    manager: h.manager,
    barrier: h.barrier,
    runtime,
  })
  const unregBefore = registerDag(before)
  let secondId: string | undefined
  let thirdId: string | undefined
  try {
    await before.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    expect(state.pauseSeq).toBe(9)
    state = { pauseSeq: 9, holds: [] }
    await before.bridge.changed("parent", { ...state, change: "resumed" })
    expect(before.registry.require("parent")).toMatchObject({ pauseSeq: 7, phase: "resumed" })

    const second = await h.manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
    expect(second.kind).toBe("started")
    if (second.kind === "started") secondId = second.task_id

    const reloadBarrier = new AdmissionBarrier()
    const reloadedManager = createTaskManager({
      cwd: h.cwd,
      store: h.store,
      config: settings({ provider_concurrency: { anthropic: 4 } }),
      planner: categoryPlanner(),
      admissionBarrier: reloadBarrier,
      runners: { "in-process": h.runner, process: h.runner },
    })
    const after = createEngineRunPause({
      stateDir: h.store.stateDir,
      manager: reloadedManager,
      barrier: reloadBarrier,
      runtime,
    })
    const unregAfter = registerDag(after)
    try {
      await after.bridge.restore("parent")
      expect(reloadBarrier.state("parent")).toEqual({ kind: "open" })
      expect(after.registry.require("parent")).toMatchObject({ pauseSeq: 7, phase: "resumed" })
      const third = await reloadedManager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
      expect(third.kind).toBe("started")
      if (third.kind === "started") thirdId = third.task_id

      await after.bridge.reconciled("parent")
      expect(dagQuiesceCount).toBe(1)
      expect(h.pausedOwners).toEqual([7])
      expect(state).toEqual({ pauseSeq: 9, holds: [] })
    } finally {
      unregAfter()
      if (thirdId !== undefined) await reloadedManager.cancelTask(thirdId)
    }
  } finally {
    unregBefore()
    h.turn.resolve({ status: "cancelled" })
    await h.manager.cancelTask(first.task_id)
    if (secondId !== undefined) await h.manager.cancelTask(secondId)
  }
})

test("restart reconcile resumes an unresumed Stop at its recorded seq when run fences raised state.pauseSeq", async () => {
  const h = makePauseHarness()
  const started = await h.manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = {
    pauseSeq: 7,
    holds: [{ kind: "session_hold", key: "session_hold:7", data: { localSeq: 7 } }],
  }
  const runtime = {
    getPauseState: () => state,
    fenceRun: (ref: RunRef) => {
      state = {
        pauseSeq: state.pauseSeq + 1,
        holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}`, data: { runRef: ref } }],
      }
    },
  }
  const before = createEngineRunPause({
    stateDir: h.store.stateDir,
    manager: h.manager,
    barrier: h.barrier,
    runtime,
  })
  try {
    await before.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    expect(state.pauseSeq).toBe(8)
    state = { pauseSeq: 8, holds: [] }
    const after = createEngineRunPause({
      stateDir: h.store.stateDir,
      manager: h.manager,
      barrier: h.barrier,
      runtime,
    })
    await after.bridge.restore("parent")
    await after.bridge.reconciled("parent")
    expect(h.manager.get(started.task_id)?.status).toBe("running")
    expect(h.pausedOwners).toEqual([7])
    expect(h.resumedOwners).toEqual([7])
    expect(after.registry.require("parent")).toMatchObject({ pauseSeq: 7, phase: "resumed" })
    expect(h.barrier.state("parent")).toEqual({ kind: "open" })
    expect(state).toEqual({ pauseSeq: 8, holds: [] })
  } finally {
    h.turn.resolve({ status: "cancelled" })
    await h.manager.cancelTask(started.task_id)
  }
})

test("restarting while the Stop is still held keeps the Stop's own seq despite run fences so DAG install matches on Resume", async () => {
  const h = makePauseHarness()
  const started = await h.manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = {
    pauseSeq: 7,
    holds: [{ kind: "session_hold", key: "session_hold:7", data: { localSeq: 7 } }],
  }
  const runtime = {
    getPauseState: () => state,
    fenceRun: (ref: RunRef) => {
      const key = `run_fence:${ref.kind}:${ref.id}`
      if (state.holds.some((hold) => hold.key === key)) return
      state = {
        pauseSeq: state.pauseSeq + 1,
        holds: [...state.holds, { kind: "run_fence", key, data: { runRef: ref } }],
      }
    },
  }
  let dagPausedSeq: number | undefined
  let dagInstalled = false
  const makeDagSource = () => ({
    refs: () => [{ kind: "dag" as const, id: "dag_1" }],
    quiesce: (_parent: string, seq: number) => {
      if ((dagPausedSeq ?? 0) < seq) dagPausedSeq = seq
    },
    install: async (_parent: string, seq: number) => {
      if (dagPausedSeq === seq) dagInstalled = true
    },
  })
  const before = createEngineRunPause({
    stateDir: h.store.stateDir,
    manager: h.manager,
    barrier: h.barrier,
    runtime,
  })
  const unreg1 = before.register(makeDagSource())
  try {
    await before.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    expect(state.pauseSeq).toBe(9)
    expect(dagPausedSeq).toBe(7)
    // Simulate a reopen where restore() runs and the user immediately resumes before a second quiesce rewrites dagPausedSeq.
    const after = createEngineRunPause({
      stateDir: h.store.stateDir,
      manager: h.manager,
      barrier: h.barrier,
      runtime,
    })
    const unreg2 = after.register({
      refs: () => [{ kind: "dag", id: "dag_1" }],
      install: async (_parent, seq) => {
        if (dagPausedSeq === seq) dagInstalled = true
      },
    })
    try {
      await after.bridge.restore("parent")
      expect(after.registry.require("parent").pauseSeq).toBe(7)
      expect(h.barrier.state("parent")).toEqual({ kind: "closed", pauseSeq: 7 })
      state = { pauseSeq: 9, holds: [] }
      await after.bridge.changed("parent", { ...state, change: "resumed" })
      expect(h.manager.get(started.task_id)?.status).toBe("running")
      expect(dagInstalled).toBe(true)
      expect(h.barrier.state("parent")).toEqual({ kind: "open" })
    } finally {
      unreg2()
    }
  } finally {
    unreg1()
    h.turn.resolve({ status: "cancelled" })
    await h.manager.cancelTask(started.task_id)
  }
})

test("changed(resumed) is not dropped when a late run fence raised state.pauseSeq without a live Stop, and cleans the orphan fence", async () => {
  const h = makePauseHarness()
  const started = await h.manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = {
    pauseSeq: 7,
    holds: [{ kind: "session_hold", key: "session_hold:7", data: { localSeq: 7 } }],
  }
  const pause = createEngineRunPause({
    stateDir: h.store.stateDir,
    manager: h.manager,
    barrier: h.barrier,
    runtime: {
      getPauseState: () => state,
      fenceRun: () => undefined,
      [RELEASE_RUN_FENCE]: (ref) => {
        const key = `run_fence:${ref.kind}:${ref.id}`
        state = { ...state, holds: state.holds.filter((hold) => hold.key !== key) }
      },
    },
  })
  try {
    await pause.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    // User resumed at seq 7, then a racing fence landed at seq 8 with no session_hold left.
    state = {
      pauseSeq: 8,
      holds: [
        {
          kind: "run_fence",
          key: `run_fence:task:${started.task_id}`,
          data: { runRef: { kind: "task", id: started.task_id } },
        },
      ],
    }
    await pause.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })
    expect(h.manager.get(started.task_id)?.status).toBe("running")
    expect(h.barrier.state("parent")).toEqual({ kind: "open" })
    expect(state.holds).toEqual([])
  } finally {
    h.turn.resolve({ status: "cancelled" })
    await h.manager.cancelTask(started.task_id)
  }
})

test("native AgentSession: Stop with run fence, prompt Resume, then reopen keeps task admission open", async () => {
  useTestTimeout(30_000)
  const root = mkdtempSync(join(tmpdir(), "run-pause-native-fence-"))
  roots.push(root)
  const server = Bun.serve({
    port: 0,
    async fetch() {
      const base = { id: "sandbox", object: "chat.completion.chunk", created: 1, model: "sandbox" }
      return new Response(
        [
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Ok." }, finish_reason: null }] })}`,
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
          "data: [DONE]",
        ].join("\n\n") + "\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const modelRegistry = ModelRegistry.inMemory(AuthStorage.inMemory())
  modelRegistry.registerProvider("sandbox", {
    api: "openai-completions",
    baseUrl: `${server.url}v1`,
    apiKey: "synthetic",
    models: [
      {
        id: "sandbox",
        name: "sandbox",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 1024,
      },
    ],
  })
  const closers: Array<() => Promise<void>> = []
  async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out`)), remainingTestTime())
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const openHost = async (sm: ReturnType<typeof SessionManager.create>, restarting: boolean) => {
    const parent = sm.getSessionId()
    const barrier = new AdmissionBarrier()
    const store = createTaskRecordStore({
      project_dir: root,
      task: { state_dir: join(root, "task-state") },
    })
    const runner = new FakeRunner()
    const turn = Promise.withResolvers<RunnerOutcome>()
    const manager = createTaskManager({
      cwd: root,
      store,
      admissionBarrier: barrier,
      planner: categoryPlanner(),
      config: settings(),
      runners: { "in-process": runner, process: runner },
      childPausePort: {
        pauseForRun: async (child) => {
          runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
          return { childSeq: 1 }
        },
        resumeTurn: async () => ({ turnId: "t2", outcome: turn.promise }),
        holdInput: async () => ({ kind: "held", entryId: "g1", duplicate: false }),
      },
    })
    const runtime = new TaskRuntimeContext(root)
    const pause = createEngineRunPause({ stateDir: store.stateDir, barrier, manager, runtime })
    const paused = Promise.withResolvers<void>()
    const resumed = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    let barrierAfterRestore = barrier.state(parent)
    const settingsManager = SettingsManager.inMemory({
      defaultProjectTrust: "always",
      compaction: { enabled: false },
    })
    const agentDir = join(root, "agent")
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        composeOmoSenpiExtension(
          [
            {
              name: "native-fence-proof",
              register(pi) {
                pi.on("session_start", async (_ev, ctx) => {
                  runtime.captureFrom(ctx as LiveTaskContext)
                  await pause.bridge.restore(parent)
                  barrierAfterRestore = barrier.state(parent)
                  await pause.bridge.reconciled(parent)
                  started.resolve()
                })
                pi.on("session_hold_changed", async (ev, ctx) => {
                  runtime.captureFrom(ctx as LiveTaskContext)
                  if (!isRunHoldChange(ev)) return
                  await pause.bridge.changed(parent, ev)
                  if (ev.change === "paused") paused.resolve()
                  if (ev.change === "resumed") resumed.resolve()
                })
              },
            },
          ],
          { logger: { info() {}, warn() {}, error() {} } },
        ),
      ],
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: root,
      agentDir,
      sessionManager: sm,
      settingsManager,
      resourceLoader: loader,
      modelRegistry,
      model: modelRegistry.find("sandbox", "sandbox"),
      thinkingLevel: "off",
      autoTitleSessions: false,
      tools: [],
      sessionStartEvent: { type: "session_start", reason: restarting ? "resume" : "startup" },
    })
    await session.bindExtensions({ mode: "print", onError() {} })
    let closed = false
    const closeSessionOnly = async () => {
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
    }
    const close = async () => {
      if (closed) return
      closed = true
      turn.resolve({ status: "cancelled" })
      for (const { record } of manager.list({ scope: "all" })) await manager.cancelTask(record.task_id)
      await closeSessionOnly()
    }
    closers.push(close)
    return {
      session,
      parent,
      barrier,
      barrierAfterRestore: () => barrierAfterRestore,
      manager,
      runtime,
      pause,
      paused: paused.promise,
      resumed: resumed.promise,
      started: started.promise,
      closeSessionOnly,
      close,
    }
  }
  try {
    const sm1 = SessionManager.create(root, join(root, "sessions"))
    const host1 = await openHost(sm1, false)
    await bounded(host1.started, "host1.started")
    await host1.session.prompt("First prompt.")
    const child = await host1.manager.start(
      baseSpec({ parent_session_id: host1.parent, root_session_id: host1.parent }),
    )
    expect(child.kind).toBe("started")
    await host1.session.stop()
    await bounded(host1.paused, "host1.paused")
    expect(host1.runtime.getPauseState()?.pauseSeq).toBe(2)
    await host1.session.prompt("Resume prompt.")
    await bounded(host1.resumed, "host1.resumed")
    expect(host1.barrier.state(host1.parent)).toEqual({ kind: "open" })
    const postResumeChild = await host1.manager.start(
      baseSpec({ parent_session_id: host1.parent, root_session_id: host1.parent }),
    )
    expect(postResumeChild.kind).toBe("started")
    const sessionFile = sm1.getSessionFile()
    if (sessionFile === undefined) throw new Error("missing session file")
    await host1.closeSessionOnly()

    const host2 = await openHost(SessionManager.open(sessionFile), true)
    await bounded(host2.started, "host2.started")
    expect(host2.barrierAfterRestore()).toEqual({ kind: "open" })
    expect(host2.barrier.state(host2.parent)).toEqual({ kind: "open" })
    expect(host2.pause.registry.require(host2.parent)).toMatchObject({
      pauseSeq: 1,
      phase: "resumed",
    })
    expect(host2.runtime.getPauseState()).toEqual({ pauseSeq: 2, holds: [] })
    const afterReopen = await host2.manager.start(
      baseSpec({ parent_session_id: host2.parent, root_session_id: host2.parent }),
    )
    expect(afterReopen.kind).toBe("started")
  } finally {
    for (const close of closers.reverse()) await close()
    server.stop(true)
  }
})

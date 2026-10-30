import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AuthStorage, createAgentSession, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager } from "../../senpi-test-runtime"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { PauseRegistry } from "../../../../senpi-task/src/pause/registry"
import { RunPauseController, type RunPauseEffects } from "../../../../senpi-task/src/pause/run-controller"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { baseSpec, categoryPlanner, FakeRunner, settings } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { EngineRunPauseBridge, isRunHoldChange } from "./run-pause-bridge"
import type { LiveTaskContext } from "./runtime-context"

test("#given quit and reopening the same stopped native session #when the person sends the next message #then a failed child restore does not keep task admission held", async () => {
  const root = mkdtempSync(join(tmpdir(), "run-pause-human-"))
  const errors: unknown[] = []
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await request.text())
      const base = { id: "sandbox", object: "chat.completion.chunk", created: 1, model: "sandbox" }
      return new Response([
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Done." }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
        "data: [DONE]",
      ].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  const registry = ModelRegistry.inMemory(AuthStorage.inMemory())
  registry.registerProvider("sandbox", {
    api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "synthetic",
    models: [{ id: "sandbox", name: "sandbox", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1024 }],
  })
  const closers: Array<() => Promise<void>> = []
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("native hold transition did not settle")), 5_000)
      })])
    } finally { clearTimeout(timer) }
  }
  const start = async (sessionManager: ReturnType<typeof SessionManager.create>, restarting: boolean) => {
    const parent = sessionManager.getSessionId()
    const barrier = new AdmissionBarrier()
    const pauseRegistry = new PauseRegistry(join(root, "task-state"), barrier)
    const paused = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const resumeSettled = Promise.withResolvers<void>()
    let view: EnginePauseState | undefined
    const effects: RunPauseEffects = {
      snapshot: () => [{ key: "child", taskId: "child", kind: "task", runEpoch: 0,
        runRef: { kind: "task", id: "child" }, state: "pending", at: "2026-01-01" }],
      quiesce: () => undefined, addFences: async () => undefined,
      pause: async () => ({ kind: "held", childSeq: 8 }),
      dispatchGuidance: async () => undefined,
      resume: async () => { throw new Error("paused child restore failed (respawn_failed)") },
      install: async () => undefined, acknowledgeInstalled: async () => undefined,
      cancel: async () => undefined,
    }
    const bridge = new EngineRunPauseBridge(new RunPauseController(pauseRegistry, effects),
      { getPauseState: () => view }, () => { released.resolve() })
    const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always", compaction: { enabled: false } })
    const agentDir = join(root, "agent")
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [composeOmoSenpiExtension([{
        name: "pause-proof",
        register(pi) {
          pi.on("session_start", async (_event, ctx) => {
            view = (ctx as LiveTaskContext).getPauseState?.()
            await bridge.restore(parent)
            await bridge.reconciled(parent)
          })
          pi.on("session_hold_changed", async (event, ctx) => {
            view = (ctx as LiveTaskContext).getPauseState?.()
            if (!isRunHoldChange(event)) return
            try { await bridge.changed(parent, event) }
            finally { if (event.change === "resumed") resumeSettled.resolve() }
            if (event.change === "paused") paused.resolve()
          })
        },
      }], { logger: { info() {}, warn() {}, error() {} } })],
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: root, agentDir, sessionManager, settingsManager, resourceLoader: loader,
      modelRegistry: registry, model: registry.find("sandbox", "sandbox"), thinkingLevel: "off",
      autoTitleSessions: false, tools: [],
      sessionStartEvent: { type: "session_start", reason: restarting ? "resume" : "startup" },
    })
    await session.bindExtensions({ mode: "print", onError: error => { errors.push(error) } })
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
    }
    closers.push(close)
    return { session, parent, barrier, pauseRegistry, paused: paused.promise, released: released.promise, resumeSettled: resumeSettled.promise, close }
  }
  try {
    const firstManager = SessionManager.create(root, join(root, "sessions"))
    const first = await start(firstManager, false)
    await first.session.prompt("Start the sandbox task.")
    await first.session.stop()
    await bounded(first.paused)
    expect(first.pauseRegistry.require(first.parent).participants.child?.state).toBe("held")
    const sessionFile = firstManager.getSessionFile()
    if (sessionFile === undefined) throw new Error("sandbox session was not persisted")
    await first.close()

    const second = await start(SessionManager.open(sessionFile), true)
    expect(second.parent).toBe(first.parent)
    const runner = new FakeRunner()
    const manager = createTaskManager({
      cwd: root, store: createTaskRecordStore({ project_dir: root, task: { state_dir: join(root, "records") } }),
      admissionBarrier: second.barrier, planner: categoryPlanner(), config: settings(),
      runners: { "in-process": runner, process: runner },
    })
    const input = baseSpec({ parent_session_id: second.parent, root_session_id: second.parent })
    expect(await manager.start(input)).toMatchObject({ kind: "held" })
    // A real person prompt releases the engine's restored Stop. No synthetic hold event or Resume command.
    await second.session.prompt("Continue working.")
    await bounded(second.resumeSettled)
    const admitted = await manager.start(input)
    expect(admitted.kind).toBe("started")
    if (admitted.kind === "started") await manager.cancelTask(admitted.task_id)
    await bounded(second.released)
    expect(second.pauseRegistry.require(second.parent)).toMatchObject({
      phase: "resumed", participants: { child: { state: "lost", lostReason: expect.stringContaining("respawn_failed") } },
    })
    expect(requests.some(body => body.includes("Continue working."))).toBe(true)
    expect(errors).toEqual([])
  } finally {
    for (const close of closers.reverse()) await close()
    server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

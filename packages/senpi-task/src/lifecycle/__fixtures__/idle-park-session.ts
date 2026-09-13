import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { EventEmitter, once } from "node:events"
import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { InProcessRunner } from "../../runners/in-process"
import { createTaskLifecycle } from "../create"
import { runTaskOutput } from "../../tools/output/output"
import { FakeRegistry, seedRecord, settings, tempStore } from "./lifecycle-fakes"

/** Restores a deterministic real AgentSession; never sends a prompt or calls a provider. */
export async function parkRealSession() {
  const { ModelRuntime, SessionManager, createAgentSession } = await loadSenpiBarrel()
  const store = tempStore()
  const id = "st_00000701"
  const agentDir = join(store.stateDir, "isolated-agent")
  const sessionDir = join(store.stateDir, "children", id, "sessions", id)
  mkdirSync(agentDir, { recursive: true })
  const sessionManager = SessionManager.create(store.stateDir, sessionDir)
  sessionManager.appendMessage({ role: "user", content: "fixture", timestamp: 1000 })
  sessionManager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "REAL_SESSION_SENTINEL" }],
    api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: 1001,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  })
  const sessionPath = sessionManager.getSessionFile()
  if (sessionPath === undefined) throw new Error("fixture session did not persist")
  const trace: string[] = []
  const runner = new InProcessRunner({ createSession: async (options) => {
    const { session } = await createAgentSession({ ...options, modelRuntime: ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false }) })
    session.subscribe((event) => trace.push(event.type))
    return session
  } })
  const handle = await runner.resume({ taskId: id, cwd: store.stateDir, sessionDir, agentDir, depth: 1, parentSessionId: "parent-1", rootSessionId: "parent-1", prompt: "must not replay" }, sessionPath)
  const transcriptBefore = readFileSync(sessionPath, "utf8")
  const registry = new FakeRegistry()
  registry.add({ task_id: id, kind: "in-process", pid: undefined,
    abort: async () => { trace.push("abort"); await handle.abort() },
    dispose: async () => { trace.push("dispose"); handle.dispose() },
    terminate: async () => { throw new Error("in-process terminate must not run") },
  })
  seedRecord(store, { task_id: id, host_pid: process.pid, updated_at: new Date(1000).toISOString() })
  store.mutate(id, (r) => ({ ...r, final_response: "REAL_SESSION_SENTINEL", spawn_spec: { version: 1, cwd: store.stateDir, prompt: "must not replay" } }))
  const events = new EventEmitter()
  const settled = once(events, "suspended", { signal: AbortSignal.timeout(5000) })
  let tick: () => void = () => { throw new Error("scheduler not registered") }
  let now = 1000
  const lifecycle = createTaskLifecycle({ store: { ...store, appendEvent: (taskId, event) => {
    const path = store.appendEvent(taskId, event)
    if (event.type === "suspended") events.emit("suspended")
    return path
  } }, registry, config: settings(), now: () => now,
    idleReclaimerScheduler: { setInterval: (callback) => { tick = callback; return {} }, clearInterval: () => undefined },
  })
  try {
    // Subscribe to the persisted suspension event before advancing the injected idle scheduler.
    now += settings().resident_idle_timeout_ms
    tick()
    await settled
    const output = await runTaskOutput({ manager: { get: (taskId) => store.load(taskId) ?? undefined, list: () => store.list().records.map((record) => ({ record })) }, stateDir: store.stateDir }, { task_id: id, mode: "full" }, "parent-1")
    return { trace, record: store.load(id), output: output.details, transcriptBefore, transcriptAfter: readFileSync(sessionPath, "utf8"), resident: registry.get(id) !== undefined, agentDir }
  } finally {
    lifecycle.dispose?.()
    if (registry.get(id) !== undefined) await lifecycle.destroyResidentTask(id, "cancel")
  }
}

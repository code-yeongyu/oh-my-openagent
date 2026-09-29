import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { COMPLETION_SETTLE_WAIT_MS, createThreadComponent } from "./component"
import { gatewayDatabasePath, gatewayInboxDirectory, gatewayRootDirectory } from "./gateway/paths"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { ThreadHost } from "./tools"

function host(): ThreadHost {
  return {
    socket: "/tmp/thread-test.sock",
    listSessions: async () => [],
    openSession: async () => ({ sessionId: "s", cwd: process.cwd() }),
    getMessages: async () => [],
    getState: async () => ({}),
    prompt: async () => ({}),
    interrupt: async () => ({}),
    setSessionName: async () => {},
    setModel: async (_sessionId, provider, modelId) => ({ provider, id: modelId }),
    getAvailableModels: async () => [],
    setThinkingLevel: async () => {},
    getAvailableThinkingLevels: async () => [],
  }
}
function context(warnings: string[]) { return { logger: { info() {}, error() {}, warn(message: string) { warnings.push(message) } }, config: { getFlag: () => undefined } } }
function api() { const tools: Record<string, unknown>[] = []; return { tools, pi: { cwd: process.cwd(), rpc: { emit() {}, handle() {} }, registerTool(tool: Record<string, unknown>) { tools.push(tool) }, on() {}, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {} } } }

type Handler = (payload: unknown, ctx?: unknown) => unknown
type CapturedTool = { readonly name: string; readonly execute: (id: string, args: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown> }
function eventApi(session?: Record<string, unknown>) {
  const handlers = new Map<string, Handler[]>()
  const tools: CapturedTool[] = []
  const pi = { cwd: process.cwd(), registerTool(tool: CapturedTool) { tools.push(tool) }, on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {}, ...(session === undefined ? {} : { session }) }
  const dispatch = async (event: string, ctx?: unknown, payload: Record<string, unknown> = {}) => { for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx) }
  const tool = (name: string) => { const found = tools.find((entry) => entry.name === name); if (found === undefined) throw new Error(`tool ${name} is not registered`); return found }
  return { pi, handlers, dispatch, tool }
}

function sessionCtx(durableId: string) { return { sessionManager: { getSessionId: () => durableId } } }

async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}`)), ms) })])
  } finally {
    clearTimeout(timer)
  }
}

/** Binds `durableId` to a custom chat thread and arms a completion through the real `thread_report` tool. */
async function bindAndArm(f: ReturnType<typeof eventApi>, store: GatewayStore, durableId: string): Promise<string> {
  const bound = await store.bind({ now: Date.now(), receipt: null, binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", root_message_id: null, progress_message_id: null, session_durable_id: durableId, direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["completion"], policy_id: "default", ttl_seconds: null } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  await f.tool("thread_report").execute("call-arm", { kind: "completion", text: "all done", binding_id: bound.binding.binding_id }, undefined, undefined, sessionCtx(durableId))
  return bound.binding.binding_id
}

async function outboxRows(store: GatewayStore, bindingId: string) {
  const page = await store.readOutbox({ now: Date.now(), binding_id: bindingId })
  return page.kind === "ok" ? page.rows.map((row) => ({ event: row.event, outcome: row.outcome, text: row.text })) : []
}

/** Another process that takes the store's write lock and keeps it until released (or stopped/killed). */
async function holdWriteLock(databasePath: string) {
  const script = 'const { Database } = await import("bun:sqlite"); const db = new Database(process.env.HOLD_DB); db.exec("PRAGMA busy_timeout = 5000"); db.exec("BEGIN IMMEDIATE"); console.log("LOCKED"); for await (const _line of console) { db.exec("COMMIT"); db.close(); process.exit(0) }'
  const child = spawn(process.execPath, ["-e", script], { env: { ...process.env, HOLD_DB: databasePath }, stdio: ["pipe", "pipe", "inherit"], windowsHide: true })
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  const locked = new Promise<void>((resolve, reject) => {
    let text = ""
    child.stdout.on("data", (chunk: Buffer) => { text += chunk.toString(); if (text.includes("LOCKED")) resolve() })
    child.once("exit", (code) => reject(new Error(`the lock holder exited (${code}) before locking`)))
  })
  await within(locked, 10_000, "the lock holder to take BEGIN IMMEDIATE")
  return {
    child,
    release: async () => { child.stdin.write("release\n"); await within(exited, 10_000, "the lock holder to commit and exit") },
    kill: async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited } },
  }
}

describe("thread component control endpoint registration", () => {
  test("#given an engine without pi.session #when the component registers #then no control endpoint is registered and only the run, startup-arm and shutdown hooks exist", () => {
    const f = eventApi()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state", agentDir: () => "/tmp/thread-test-agent" }).register(f.pi as never, context([]) as never)
    expect([...f.handlers.keys()].sort()).toEqual(["agent_end", "agent_settled", "agent_start", "session_shutdown", "session_start"])
  })

  test("#given a completion armed through thread_report #when agent_end fires and then the session settles #then exactly one completion row appears, only after the settle", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-completion-"))
    const store = createGatewayStore({ agentDir })
    try {
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(f.pi as never, context([]) as never)
      const bound = await store.bind({ now: Date.now(), receipt: null, binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", root_message_id: null, progress_message_id: null, session_durable_id: "dur-1", direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["completion"], policy_id: "default", ttl_seconds: null } })
      if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
      await f.tool("thread_report").execute("call-arm", { kind: "completion", text: "all done", binding_id: bound.binding.binding_id }, undefined, undefined, sessionCtx("dur-1"))
      const ctx = sessionCtx("dur-1")
      const rows = async () => { const page = await store.readOutbox({ now: Date.now(), binding_id: bound.binding.binding_id }); return page.kind === "ok" ? page.rows : [] }
      for (const handler of f.handlers.get("agent_end") ?? []) await handler({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }, ctx)
      expect(await rows()).toEqual([])
      await f.dispatch("agent_settled", ctx)
      expect((await rows()).map((row) => ({ event: row.event, outcome: row.outcome, text: row.text }))).toEqual([{ event: "completion", outcome: "failed", text: "all done" }])
      await f.dispatch("agent_settled", ctx)
      expect(await rows()).toHaveLength(1)
    } finally {
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given an engine with pi.session #when session_start fires #then the header is persisted before the endpoint registers on this session's inbox, and shutdown disposes it", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-"))
    try {
      const calls: string[] = []
      let registered: { inboxDir: string } | undefined
      let disposed!: () => void
      const disposal = new Promise<void>((resolve) => { disposed = resolve })
      const session = {
        persistHeaderNow: async () => { calls.push("persistHeaderNow") },
        registerControlEndpoint: async (options: { inboxDir: string }) => {
          calls.push("registerControlEndpoint")
          registered = options
          return { status: "registered", socket: "/tmp/t-0123456789abcdef.sock", dispose: async () => { calls.push("dispose"); disposed() } }
        },
        admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 0 }),
        admitExternalMessage: () => ({ kind: "started", turn_epoch: 1 }),
        listAdmittedDeliveries: () => ({ pending: [], emitted: [] }),
      }
      const f = eventApi(session)
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir }).register(f.pi as never, context([]) as never)
      const ctx = { sessionManager: { getSessionId: () => "dur-1", getSessionFile: () => join(agentDir, "dur-1.jsonl") }, isIdle: () => true }
      await f.dispatch("session_start", ctx)
      await f.dispatch("session_shutdown", ctx)
      await disposal
      expect(calls).toEqual(["persistHeaderNow", "registerControlEndpoint", "dispose"])
      expect(registered?.inboxDir).toBe(gatewayInboxDirectory(agentDir, "dur-1"))
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })
})

describe("thread component settle never waits on the gateway store", () => {
  test("#given a session that armed no completion #when turns end and it settles #then the settle makes no store call and no gateway database is created", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-unbound-"))
    try {
      const own = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir }).register(own.pi as never, context([]) as never)
      const calls: string[] = []
      const spy = new Proxy({}, { get: (_target, name) => (name === "then" ? undefined : (..._args: unknown[]) => { calls.push(String(name)); return Promise.resolve(undefined) }) }) as GatewayStore
      const spied = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: spy }).register(spied.pi as never, context([]) as never)
      const registrationCalls = [...calls]
      for (const f of [own, spied]) {
        for (const end of [{ messages: [{ role: "assistant", stopReason: "stop" }] }, { aborted: true, messages: [] }]) {
          await f.dispatch("agent_start", sessionCtx("dur-plain"))
          await f.dispatch("agent_end", sessionCtx("dur-plain"), end)
          await f.dispatch("agent_settled", sessionCtx("dur-plain"))
        }
      }
      expect({ settleCalls: calls.slice(registrationCalls.length), db: existsSync(gatewayDatabasePath(agentDir)), gatewayDir: existsSync(gatewayRootDirectory(agentDir)) }).toEqual({ settleCalls: [], db: false, gatewayDir: false })
      await own.dispatch("session_shutdown")
      expect(existsSync(gatewayDatabasePath(agentDir))).toBe(false)
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given an armed completion and another process holding the store's write lock #when the session settles #then the settle returns within its bound, and the completion is written once the lock frees", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-held-"))
    const store = createGatewayStore({ agentDir, _test: { busyTimeoutMs: 100 } })
    let holder: Awaited<ReturnType<typeof holdWriteLock>> | undefined
    try {
      const warnings: string[] = []
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(f.pi as never, context(warnings) as never)
      const bindingId = await bindAndArm(f, store, "dur-1")
      await f.dispatch("agent_end", sessionCtx("dur-1"), { messages: [{ role: "assistant", stopReason: "stop" }] })
      holder = await holdWriteLock(gatewayDatabasePath(agentDir))
      const started = performance.now()
      await within(f.dispatch("agent_settled", sessionCtx("dur-1")), 10_000, "agent_settled to return while another process holds the write lock")
      expect(performance.now() - started).toBeLessThan(COMPLETION_SETTLE_WAIT_MS + 2_750)
      await holder.release()
      expect(await within(outboxRows(store, bindingId), 10_000, "the outbox read queued behind the completion write")).toEqual([{ event: "completion", outcome: "completed", text: "all done" }])
      expect(warnings).toEqual([])
    } finally {
      await holder?.kill()
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given an armed settle whose write outlasts the lock-wait bound behind a SIGSTOPped holder #when the holder resumes #then exactly one completion row lands in the background with the original run's outcome, and later settles add none", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-stopped-"))
    const store = createGatewayStore({ agentDir, _test: { busyTimeoutMs: 100, lockWaitMaxMs: 1_000 } })
    let holder: Awaited<ReturnType<typeof holdWriteLock>> | undefined
    try {
      const warnings: string[] = []
      let reported!: (message: string) => void
      const firstWarning = new Promise<string>((resolve) => { reported = resolve })
      const logger = { logger: { info() {}, error() {}, warn(message: string) { warnings.push(message); reported(message) } }, config: { getFlag: () => undefined } }
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(f.pi as never, logger as never)
      const bindingId = await bindAndArm(f, store, "dur-1")
      await f.dispatch("agent_end", sessionCtx("dur-1"), { messages: [{ role: "assistant", stopReason: "error" }] })
      holder = await holdWriteLock(gatewayDatabasePath(agentDir))
      holder.child.kill("SIGSTOP")
      const started = performance.now()
      await within(f.dispatch("agent_settled", sessionCtx("dur-1")), 10_000, "agent_settled to return while a stopped process holds the write lock")
      expect(performance.now() - started).toBeLessThan(COMPLETION_SETTLE_WAIT_MS + 2_750)
      const warning = await within(firstWarning, 15_000, "the delayed completion write to be reported")
      expect(warning).toContain("retrying")
      const waited = Number(/waited (\d+) ms/.exec(warning)?.[1])
      expect(waited).toBeLessThan(1_000)
      await f.dispatch("agent_start", sessionCtx("dur-1"))
      await f.dispatch("agent_end", sessionCtx("dur-1"), { messages: [{ role: "assistant", stopReason: "stop" }] })
      await within(f.dispatch("agent_settled", sessionCtx("dur-1")), 10_000, "a later settle to return while the first write is still outstanding")
      const emitted = new Promise<void>((resolve) => {
        const stop = store.onEvent((event) => {
          if (event.kind !== "completions_emitted" || event.cursors.length === 0) return
          stop()
          resolve()
        })
      })
      holder.child.kill("SIGCONT")
      await holder.release()
      await within(emitted, 15_000, "the background retry to write the completion once the lock frees")
      expect(await outboxRows(store, bindingId)).toEqual([{ event: "completion", outcome: "failed", text: "all done" }])
      await f.dispatch("agent_start", sessionCtx("dur-1"))
      await f.dispatch("agent_end", sessionCtx("dur-1"), { messages: [{ role: "assistant", stopReason: "stop" }] })
      await f.dispatch("agent_settled", sessionCtx("dur-1"))
      expect(await outboxRows(store, bindingId)).toHaveLength(1)
      expect(warnings.every((line) => line.includes("retrying"))).toBe(true)
    } finally {
      await holder?.kill()
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  }, 60_000)

  test("#given a completion armed by a runtime that shut down before any settle #when a new runtime starts the same session and it settles #then the durable arm is picked up and written once", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-restart-"))
    const first = createGatewayStore({ agentDir, instanceId: "runtime-1" })
    const second = createGatewayStore({ agentDir, instanceId: "runtime-2" })
    try {
      const before = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: first }).register(before.pi as never, context([]) as never)
      const bindingId = await bindAndArm(before, first, "dur-1")
      await before.dispatch("session_shutdown")
      await first.dispose()
      const warnings: string[] = []
      const after = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: second }).register(after.pi as never, context(warnings) as never)
      await after.dispatch("session_start", sessionCtx("dur-1"))
      expect(await second.pendingCompletionArms("dur-1")).toBe(1)
      await after.dispatch("agent_start", sessionCtx("dur-1"))
      await after.dispatch("agent_end", sessionCtx("dur-1"), { messages: [{ role: "assistant", stopReason: "stop" }] })
      await within(after.dispatch("agent_settled", sessionCtx("dur-1")), 10_000, "the settle after the restart")
      expect(await outboxRows(second, bindingId)).toEqual([{ event: "completion", outcome: "completed", text: "all done" }])
      await after.dispatch("agent_end", sessionCtx("dur-1"), { messages: [{ role: "assistant", stopReason: "stop" }] })
      await after.dispatch("agent_settled", sessionCtx("dur-1"))
      expect({ rows: (await outboxRows(second, bindingId)).length, arms: await second.pendingCompletionArms("dur-1"), warnings }).toEqual({ rows: 1, arms: 0, warnings: [] })
    } finally {
      await first.dispose()
      await second.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })
})

const SEVENTEEN = [
  "thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff", "thread_rename", "thread_set_model", "thread_set_reasoning",
  "thread_bind", "thread_unbind", "thread_rebind", "thread_bindings", "thread_report", "thread_outbox", "thread_outbox_ack", "thread_answer",
]

describe("thread component production registration", () => {
  test("registers all seventeen tools when a test host is supplied", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools.map((tool) => tool.name)).toEqual(SEVENTEEN)
  })

  test("registers the family regardless of the context flag", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools.map((tool) => tool.name)).toEqual(SEVENTEEN)
  })

  test("registers all seventeen tools when a test host is supplied and no host flag exists", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools).toHaveLength(17)
  })
})

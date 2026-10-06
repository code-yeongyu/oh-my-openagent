import { describe, expect, jest, test } from "bun:test"
import { Database } from "bun:sqlite"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { COMPLETION_SETTLE_WAIT_MS, createThreadComponent } from "./component"
import { createGatewayEngine, resolveFromEntries, type GatewayAddressEntry } from "./gateway/engine"
import { gatewayDatabasePath, gatewayInboxDirectory, gatewayRootDirectory } from "./gateway/paths"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { resumeProcess, suspendProcess } from "./gateway/testing/job-control"
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

/**
 * Restarts the runtime's store over a completion-report receipt stored the way the revision before `arm_seq` stored it:
 * armed, with no sequence. `store` is closed first (its close waits behind every write it still has queued), so the
 * receipt is rewritten while no store has the file open, and the store the restarted runtime opens reads it as found.
 */
async function restartOverLegacyReportReceipt(agentDir: string, store: GatewayStore): Promise<{ readonly store: GatewayStore; readonly rewritten: number }> {
  await store.dispose()
  const db = new Database(gatewayDatabasePath(agentDir))
  let rewritten: number
  try {
    rewritten = db.run("UPDATE receipts SET result = json_remove(result, '$.arm_seq') WHERE status = 'completed' AND json_extract(result, '$.armed') = 1 AND json_type(result, '$.arm_seq') IS NOT NULL").changes
  } finally {
    db.close()
  }
  return { store: createGatewayStore({ agentDir }), rewritten }
}

/** A component over `store` whose completion writes record the watermark each one was given. */
function watermarkedComponent(agentDir: string, store: GatewayStore, watermarks: unknown[]) {
  const f = eventApi()
  const observed: GatewayStore = { ...store, emitCompletions: async (request) => { watermarks.push(request.through_arm_seq); return await store.emitCompletions(request) } }
  createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: observed }).register(f.pi as never, context([]) as never)
  return f
}

async function settleRun(f: ReturnType<typeof eventApi>, durableId: string): Promise<void> {
  await f.dispatch("agent_end", sessionCtx(durableId), { messages: [{ role: "assistant", stopReason: "stop" }] })
  await f.dispatch("agent_settled", sessionCtx(durableId))
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
  const pid = child.pid
  if (pid === undefined) throw new Error("the lock holder has no pid")
  return {
    child,
    pid,
    release: async () => { child.stdin.write("release\n"); await within(exited, 10_000, "the lock holder to commit and exit") },
    kill: async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited } },
  }
}

describe("thread component control endpoint registration", () => {
  test("#given an engine without pi.session #when the component registers #then none of the control endpoint's hooks (compaction and waiting-question tracking) is registered", () => {
    const f = eventApi()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state", agentDir: () => "/tmp/thread-test-agent" }).register(f.pi as never, context([]) as never)
    expect(["session_before_compact", "session_compact", "tool_execution_start", "tool_execution_end"].filter((event) => f.handlers.has(event))).toEqual([])
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

  test("#given a completion report whose stored receipt predates arm_seq #when a restarted runtime replays the same report #then it arms the session's durable arm and the next settle writes the completion with an integer watermark", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-legacy-arm-"))
    const stores = [createGatewayStore({ agentDir })]
    const watermarks: unknown[] = []
    try {
      const before = watermarkedComponent(agentDir, stores[0], watermarks)
      const bindingId = await bindAndArm(before, stores[0], "dur-1")
      const restarted = await restartOverLegacyReportReceipt(agentDir, stores[0])
      stores.push(restarted.store)
      expect(restarted.rewritten).toBe(1)

      const after = watermarkedComponent(agentDir, restarted.store, watermarks)
      const replay = (await after.tool("thread_report").execute("call-arm", { kind: "completion", text: "all done", binding_id: bindingId }, undefined, undefined, sessionCtx("dur-1"))) as { details: { result: unknown } }
      expect(replay.details.result).toMatchObject({ kind: "ok", armed: true, deduplicated: true })
      await settleRun(after, "dur-1")

      expect(await outboxRows(restarted.store, bindingId)).toEqual([{ event: "completion", outcome: "completed", text: "all done" }])
      expect(watermarks.map((watermark) => Number.isInteger(watermark))).toEqual([true])
    } finally {
      for (const store of stores) await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given a completion report whose stored receipt predates arm_seq and whose completion was already written #when a restarted runtime replays the report #then it answers idempotency_uncertain, arms nothing, and no settle writes a second completion", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-legacy-arm-gone-"))
    const stores = [createGatewayStore({ agentDir })]
    const watermarks: unknown[] = []
    try {
      const before = watermarkedComponent(agentDir, stores[0], watermarks)
      const bindingId = await bindAndArm(before, stores[0], "dur-1")
      await settleRun(before, "dur-1")
      expect(await outboxRows(stores[0], bindingId)).toEqual([{ event: "completion", outcome: "completed", text: "all done" }])
      const restarted = await restartOverLegacyReportReceipt(agentDir, stores[0])
      stores.push(restarted.store)
      expect(restarted.rewritten).toBe(1)

      const after = watermarkedComponent(agentDir, restarted.store, watermarks)
      const replay = (await after.tool("thread_report").execute("call-arm", { kind: "completion", text: "all done", binding_id: bindingId }, undefined, undefined, sessionCtx("dur-1"))) as { details: { result: unknown } }
      expect(replay.details.result).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
      await settleRun(after, "dur-1")

      expect(await outboxRows(restarted.store, bindingId)).toHaveLength(1)
      expect(watermarks.map((watermark) => Number.isInteger(watermark))).toEqual([true])
    } finally {
      for (const store of stores) await store.dispose()
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

describe("thread component steer into a session waiting on a question", () => {
  test("#given a running session blocked on an ask_user question that waits for its answer #when a steer for its turn arrives #then it is refused not_steerable and never reaches the runtime; a question that does not wait blocks nothing, and once the blocking question ends the next steer is steered", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-question-"))
    const store = createGatewayStore({ agentDir })
    const socket = "/tmp/t-0123456789abcdef.sock"
    let drain: ((event: unknown) => Promise<unknown>) | undefined
    let endpointRegistered!: () => void
    const endpointReady = new Promise<void>((resolve) => { endpointRegistered = resolve })
    const admitted: string[] = []
    const session = {
      persistHeaderNow: async () => undefined,
      registerControlEndpoint: async (options: { drain: (event: unknown) => Promise<unknown> }) => {
        drain = options.drain
        endpointRegistered()
        return { status: "registered", socket, dispose: async () => undefined }
      },
      admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 3 }),
      admitExternalMessage: (input: { readonly delivery_id: string }) => {
        admitted.push(input.delivery_id)
        return { kind: "steered", turn_epoch: 3 }
      },
      listAdmittedDeliveries: () => ({ pending: [...admitted], emitted: [] }),
    }
    const f = eventApi(session)
    // A session in a run: senpi reports it busy for the whole run, a blocking question included.
    const ctx = { sessionManager: { getSessionId: () => "dur-1", getSessionFile: () => join(agentDir, "dur-1.jsonl") }, isIdle: () => false }
    try {
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(f.pi as never, context([]) as never)
      await f.dispatch("session_start", ctx)
      await within(endpointReady, 10_000, "the control endpoint to register")
      const target: GatewayAddressEntry = { thread_id: "dur-1", name: "lane", status: "live", cwd: agentDir, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(), endpoint: { kind: "tui", socket, routing_id: null }, liveness: "routable" }
      const engine = createGatewayEngine({
        store,
        endpoints: {
          wake: async (_endpoint, ids) => {
            if (drain === undefined) throw new Error("the component registered no drain")
            return (await drain({ type: "session_control_wake", reason: "command", reasons: ["command"], delivery_ids: ids })) as never
          },
        },
        resolve: resolveFromEntries(() => [target], () => agentDir),
      })
      const steer = async (text: string) => {
        const sent = await engine.deliver({ sender: { kind: "session", durable_id: "dur-peer" }, target: "dur-1", text, mode: "steer", expected_turn_id: 3 })
        const id = sent.kind === "ok" ? sent.delivery_id : sent.error.details?.delivery_id
        if (typeof id !== "string") throw new Error(`the steer was not written: ${JSON.stringify(sent)}`)
        const row = (await store.deliveryView(id))?.row
        return { sender: sent.kind === "ok" ? sent.delivery.kind : sent.error.code, state: row?.state, reason: row?.reason ?? null, reached: admitted.includes(id) }
      }
      // senpi's ask_user tool (`ask_user_question`, or `request_user_input` for the codex family): a
      // question that waits for its answer holds the tool call open until the user answers.
      const ask = (toolCallId: string, toolName: string, args: Record<string, unknown>) => f.dispatch("tool_execution_start", ctx, { toolCallId, toolName, args })
      const settle = (toolCallId: string, toolName: string) => f.dispatch("tool_execution_end", ctx, { toolCallId, toolName, result: { content: [] }, isError: false })
      await f.dispatch("agent_start", ctx)

      await ask("ask-1", "ask_user_question", { questions: [], waitForAnswer: true })
      expect(await steer("while the question waits")).toEqual({ sender: "not_steerable", state: "refused", reason: "not_steerable", reached: false })
      await settle("ask-1", "ask_user_question")

      await ask("ask-2", "request_user_input", { questions: [], wait_for_answer: true })
      expect(await steer("while the codex-family question waits")).toEqual({ sender: "not_steerable", state: "refused", reason: "not_steerable", reached: false })
      await settle("ask-2", "request_user_input")

      await ask("ask-3", "ask_user_question", { questions: [], waitForAnswer: false })
      expect(await steer("beside a question that does not wait")).toEqual({ sender: "steered", state: "admitted", reason: null, reached: true })
      await settle("ask-3", "ask_user_question")

      expect(await steer("after the questions ended")).toEqual({ sender: "steered", state: "admitted", reason: null, reached: true })
    } finally {
      await f.dispatch("session_shutdown", ctx)
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })
})

describe("thread component legacy mailbox import", () => {
  test("#given the pre-gateway mailbox of this workspace holds undelivered items #when the production component starts a session #then they are queued in the gateway store and the item naming no session is reported", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-legacy-"))
    try {
      const stateDirectory = join(agentDir, "state")
      mkdirSync(join(stateDirectory, "mailbox"), { recursive: true })
      const item = (seq: number, target: string) => ({ target, message: `m${seq}`, message_seq: seq, delivery: "auto", operation_id: `op-${seq}`, accepted_at: "2026-09-28T00:00:00.000Z" })
      writeFileSync(join(stateDirectory, "mailbox", "mailbox.jsonl"), `${[
        { version: 1, kind: "snapshot", next_seq: 1, items: [] },
        { version: 1, kind: "enqueue", item: item(1, "dur-target") },
        { version: 1, kind: "enqueue", item: item(2, "no such id/") },
      ].map((event) => JSON.stringify(event)).join("\n")}\n`)
      const warnings: string[] = []
      let reported!: () => void
      const skippedReport = new Promise<void>((resolve) => { reported = resolve })
      const logger = { logger: { info() {}, error() {}, warn(message: string) { warnings.push(message); if (message.includes("#2")) reported() } }, config: { getFlag: () => undefined } }
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory, agentDir: () => agentDir }).register(f.pi as never, logger as never)
      await f.dispatch("session_start", sessionCtx("dur-sender"))
      await within(skippedReport, 10_000, "the skipped legacy item to be reported")
      await f.dispatch("session_shutdown")
      const store = createGatewayStore({ agentDir })
      try {
        expect((await store.list({ target_durable_id: "dur-target" })).map((row) => [row.body, row.state])).toEqual([["m1", "queued"]])
      } finally {
        await store.dispose()
      }
      expect(warnings.filter((message) => message.includes("legacy"))).toHaveLength(1)
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given an unreadable legacy mailbox #when the store reopens after its idle worker retired #then the failure is reported once, not at every reopen", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-legacy-invalid-"))
    try {
      const stateDirectory = join(agentDir, "state")
      // mailbox.jsonl as a directory: the legacy import cannot read it at any open.
      mkdirSync(join(stateDirectory, "mailbox", "mailbox.jsonl"), { recursive: true })
      const warnings: string[] = []
      let retired!: () => void
      const firstRetire = new Promise<void>((resolve) => { retired = resolve })
      const store = createGatewayStore({ agentDir, legacyMailboxDirectories: [join(stateDirectory, "mailbox")], _test: { idleRetireMs: 1, onWorkerRetired: () => retired() } })
      let invalidSeen = 0
      let secondInvalid!: () => void
      const reopened = new Promise<void>((resolve) => { secondInvalid = resolve })
      store.onEvent((event) => { if (event.kind === "legacy_mailbox_invalid" && ++invalidSeen === 2) secondInvalid() })
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory, agentDir: () => agentDir, store }).register(f.pi as never, context(warnings) as never)
      await store.stats()
      await within(firstRetire, 10_000, "the idle store worker to retire")
      await store.stats()
      await within(reopened, 10_000, "the reopened store to retry the unreadable mailbox")
      expect(warnings.filter((message) => message.includes("legacy thread mailbox"))).toHaveLength(1)
      await store.dispose()
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })
})

describe("thread component startup and shutdown touch no store they do not need", () => {
  test("#given a session with no gateway store on disk #when session_start runs and the session shuts down #then no gateway directory and no database are created", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-startup-"))
    try {
      const warnings: string[] = []
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir }).register(f.pi as never, context(warnings) as never)
      await f.dispatch("session_start", sessionCtx("dur-plain"))
      // Shutdown disposes the store, which waits for any worker the start-up read would have opened.
      await f.dispatch("session_shutdown")
      expect({ gatewayDir: existsSync(gatewayRootDirectory(agentDir)), db: existsSync(gatewayDatabasePath(agentDir)), warnings }).toEqual({ gatewayDir: false, db: false, warnings: [] })
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given a terminal senpi cannot register (Windows answers unsupported_platform) #when session_start runs and the session shuts down #then no gateway database, no inbox and no incarnation row exist, and nothing is logged", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-unsupported-"))
    try {
      const warnings: string[] = []
      const calls: string[] = []
      let answered!: () => void
      const registrarAnswered = new Promise<void>((resolve) => { answered = resolve })
      const session = {
        persistHeaderNow: async () => { calls.push("persistHeaderNow") },
        registerControlEndpoint: async () => {
          calls.push("registerControlEndpoint")
          answered()
          return { status: "unsupported", reason: "unsupported_platform" }
        },
        admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 0 }),
        admitExternalMessage: () => ({ kind: "started", turn_epoch: 1 }),
        listAdmittedDeliveries: () => ({ pending: [], emitted: [] }),
      }
      const f = eventApi(session)
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir }).register(f.pi as never, context(warnings) as never)
      const ctx = { sessionManager: { getSessionId: () => "dur-win", getSessionFile: () => join(agentDir, "dur-win.jsonl") }, isIdle: () => true }
      await f.dispatch("session_start", ctx)
      await within(registrarAnswered, 10_000, "senpi's registrar to be asked")
      // Shutdown waits for the registration still in flight, then disposes the store.
      await f.dispatch("session_shutdown", ctx)
      const database = gatewayDatabasePath(agentDir)
      const incarnation = existsSync(database) ? (() => { const db = new Database(database); try { return db.query("SELECT incarnation FROM session_meta WHERE durable_id = 'dur-win'").get() } finally { db.close() } })() : null
      expect({ calls, database: existsSync(database), inbox: existsSync(join(gatewayRootDirectory(agentDir), "inbox")), incarnation, warnings }).toEqual({ calls: ["persistHeaderNow", "registerControlEndpoint"], database: false, inbox: false, incarnation: null, warnings: [] })
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given an answer release that gave up at the store's lock-wait bound #when the session shuts down #then the background release retry makes no further attempt", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-release-"))
    const real = createGatewayStore({ agentDir, _test: { busyTimeoutMs: 50 } })
    try {
      let releases = 0
      const store: GatewayStore = {
        ...real,
        releaseAnswer: async (request) => {
          releases++
          if (releases === 1) throw Object.assign(new Error("gateway store lock wait exceeded: release_answer waited 25000 ms for the write lock (limit 30000 ms); another process holds it"), { code: "gateway_lock_wait_exceeded" })
          return await real.releaseAnswer(request)
        },
      }
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(f.pi as never, context([]) as never)
      const bound = await real.bind({ now: Date.now(), receipt: null, binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", root_message_id: null, progress_message_id: null, session_durable_id: "dur-1", direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["question"], policy_id: "default", ttl_seconds: null } })
      if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
      const asked = await real.report({ now: Date.now(), receipt: null, origin_delivery_ids: [], session_durable_id: "dur-1", binding_id: bound.binding.binding_id, event: "question", text: "deploy?", ui_request_id: "ui-1", ui_request_kind: null })
      if (asked.kind !== "ok" || asked.reply_token === null) throw new Error(JSON.stringify(asked))
      // No host gateway port: the answer is claimed, cannot be handed off, and its release hits the
      // bound. The retry it arms runs on the fake clock, so the test decides when it would be due.
      jest.useFakeTimers()
      try {
        await f.tool("thread_answer").execute("call-answer", { binding_id: bound.binding.binding_id, reply_token: asked.reply_token, answer: "yes" }, undefined, undefined, sessionCtx("dur-2"))
        expect(releases).toBe(1)
        await f.dispatch("session_shutdown")
        // Well past the retry's due time: a retry that survived shutdown would count itself here.
        jest.advanceTimersByTime(real.busyTimeoutMs * 4)
        expect(releases).toBe(1)
      } finally {
        jest.useRealTimers()
      }
    } finally {
      await real.dispose()
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

  // win32 has no job control: nothing there can suspend the lock holder the way SIGSTOP does
  test.skipIf(process.platform === "win32")("#given an armed settle whose write outlasts the lock-wait bound behind a SIGSTOPped holder #when the holder resumes #then exactly one completion row lands in the background with the original run's outcome, and later settles add none", async () => {
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
      await suspendProcess(holder.pid)
      const started = performance.now()
      await within(f.dispatch("agent_settled", sessionCtx("dur-1")), 10_000, "agent_settled to return while a stopped process holds the write lock")
      expect(performance.now() - started).toBeLessThan(COMPLETION_SETTLE_WAIT_MS + 2_750)
      const warning = await within(firstWarning, 15_000, "the delayed completion write to be reported")
      expect(warning).toContain("retrying")
      const waited = Number(/waited (\d+) ms/.exec(warning)?.[1])
      // The store gives up once another busy step could carry the wait past lockWaitMaxMs (1_000), i.e. at a
      // check where waited + 2 * busyTimeoutMs (100) > 1_000. That rule, not a wall-clock ceiling, is what the
      // report proves: it waited out the window instead of bailing on the first busy reply. Timer lateness on
      // a loaded runner can push the measured value past 1_000 (#9487).
      expect(waited).toBeGreaterThan(1_000 - 2 * 100)
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
      await resumeProcess(holder.pid)
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

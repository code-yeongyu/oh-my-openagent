import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createThreadComponent } from "./component"
import type { RegisterControlEndpointOptions } from "./gateway/adapter"
import { gatewayDatabasePath } from "./gateway/paths"
import { GATEWAY_MIGRATIONS } from "./gateway/schema"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

/**
 * A bound session's ask_user question reaches its chat thread without the model relaying it: the
 * session's component writes the outbox question row itself when senpi announces the question
 * (`ask-user:asked`), with what a connector renders it from (the options, whether the session waits).
 * One row per request: when the model also relays the same request with `thread_report`, whichever came
 * first owns the row and the other gets that row back. An unbound session writes nothing.
 */

const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"
const EVENT_WAIT_MS = 10_000
const directories: string[] = []
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Handler = (payload: unknown, ctx?: unknown) => unknown
type CapturedTool = { readonly name: string; readonly execute: (id: string, args: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ readonly details?: unknown }> }

function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${EVENT_WAIT_MS} ms for ${what}`)), EVENT_WAIT_MS)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

function host(): ThreadHost {
  const session: ThreadHostSession = { sessionId: "rpc-1", durableSessionId: "dur-1", cwd: process.cwd(), name: "lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-question-mirror-legacy.sock",
    listSessions: async () => [session],
    listTarget: async (_id, endpoint) => {
      const sessions = [{ ...session, socket: endpoint.socket, endpoint_kind: endpoint.kind }]
      return { sessions, hosts: [{ socket: endpoint.socket, list_sessions: { sessions }, endpoint_kind: endpoint.kind, alive: true }], disk: [] }
    },
    listView: async () => ({ sessions: [session], hosts: [{ socket: HOST_SOCKET, list_sessions: { sessions: [session] }, endpoint_kind: "rpc_host", alive: true }], disk: [] }),
    openSession: unused,
    getMessages: async () => [],
    getState: async () => ({ isStreaming: false }),
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    gateway: { wake: async () => ({ admitted: [] }) },
  }
}

const SINGLE = {
  requestId: "ask-1",
  questions: [{ id: "q1", header: "Deploy", question: "Ship to production now?", options: [{ label: "Ship it" }, { label: "Wait for review", description: "after the PR is approved" }], multiSelect: false }],
  waitForAnswer: true,
  timeoutMs: 600_000,
}

async function setup(options: { readonly bind?: boolean; readonly outboundEvents?: readonly string[] } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-question-mirror-"))
  directories.push(agentDir)
  const runtimeStore = createGatewayStore({ agentDir, instanceId: "runtime-1" })
  const connectorStore = createGatewayStore({ agentDir, instanceId: "connector-1" })
  cleanups.push(() => runtimeStore.dispose(), () => connectorStore.dispose())
  /** Every mirror the component starts, so a test awaits the write instead of a guessed delay. */
  const mirrors: Promise<unknown>[] = []
  const closes: Promise<number>[] = []
  const sessionStore: GatewayStore = {
    ...runtimeStore,
    mirrorQuestion: (request) => {
      const write = runtimeStore.mirrorQuestion(request)
      mirrors.push(write)
      return write
    },
    closeQuestion: (request) => {
      const write = runtimeStore.closeQuestion(request)
      closes.push(write)
      return write
    },
  }
  const handlers = new Map<string, Handler[]>()
  const bus = new Map<string, ((payload: unknown) => void)[]>()
  const tools: CapturedTool[] = []
  let endpointRegistered: () => void = () => undefined
  const endpointReady = new Promise<void>((resolve) => { endpointRegistered = resolve })
  const session = {
    persistHeaderNow: async () => undefined,
    registerControlEndpoint: async (_registration: RegisterControlEndpointOptions) => {
      endpointRegistered()
      return { status: "registered", socket: HOST_SOCKET, dispose: async () => undefined }
    },
    admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 1 }),
    admitExternalMessage: () => ({ kind: "started", turn_epoch: 1 }),
    listAdmittedDeliveries: () => ({ pending: [], emitted: [] }),
  }
  const pi = {
    cwd: process.cwd(), sessionContext: { host_instance: "runtime-1" }, session,
    registerTool(tool: CapturedTool) { tools.push(tool) },
    on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    events: {
      emit(name: string, payload: unknown) { for (const handler of bus.get(name) ?? []) handler(payload) },
      on(name: string, handler: (payload: unknown) => void) { bus.set(name, [...(bus.get(name) ?? []), handler]); return () => undefined },
    },
    registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {},
  }
  const ctx = { sessionManager: { getSessionId: () => "dur-1", getSessionFile: () => join(agentDir, "dur-1.jsonl") }, isIdle: () => true }
  const dispatch = async (event: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx)
  }
  const logger = { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } }
  createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: sessionStore }).register(pi as never, logger as never)
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host: host(), store: connectorStore })
  cleanups.push(() => sdk.dispose())
  await dispatch("session_start")
  await within(endpointReady, "the control endpoint to register")
  let bindingId: string | undefined
  if (options.bind !== false) {
    const bound = await sdk.bind({ session: "dur-1", binding: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "t1", ...(options.outboundEvents === undefined ? {} : { outbound_events: options.outboundEvents }) } as never })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    bindingId = bound.binding.binding_id
  }
  const ask = async (request: object = SINGLE) => {
    const before = mirrors.length
    pi.events.emit("ask-user:asked", { ctx, request, variant: "claude" })
    await within(Promise.all(mirrors.slice(before)), "the mirrored question write")
  }
  const closeLocally = (request: string) => pi.events.emit("ask-user:closed", { requestId: request, status: "answered" })
  let calls = 0
  const report = async (request: string, extra: Record<string, unknown> = {}) => {
    const call = `call-${++calls}`
    const args = Object.fromEntries(Object.entries({ kind: "question", text: `relayed ${request}`, request_id: request, request_kind: "question", ...extra }).filter(([, value]) => value !== undefined))
    await dispatch("tool_execution_start", { toolCallId: call, toolName: "thread_report", args })
    const tool = tools.find((entry) => entry.name === "thread_report")
    if (tool === undefined) throw new Error("thread_report is not registered")
    const result = ((await tool.execute(call, args, undefined, undefined, ctx)).details as { readonly result: Record<string, unknown> }).result
    await dispatch("tool_execution_end", { toolCallId: call, toolName: "thread_report" })
    return result
  }
  const outbox = async () => {
    if (bindingId === undefined) throw new Error("no binding")
    const page = await connectorStore.readOutbox({ now: Date.now(), binding_id: bindingId, after_cursor: 0, limit: 100 })
    if (page.kind !== "ok") throw new Error(JSON.stringify(page))
    return page.rows
  }
  return { agentDir, sdk, ask, report, closeLocally, outbox, closes, connectorStore, runtimeStore, get bindingId() { return bindingId } }
}

test("#given a bound session #when it asks one ask_user question #then its thread gets one question row with the options and blocking flag, which a chat answer resolves", async () => {
  const s = await setup()
  await s.ask()
  const rows = await s.outbox()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ event: "question", question_state: "pending", options: ["Ship it", "Wait for review"], blocking: true, ask_hint: null })
  expect(rows[0]?.text).toContain("Ship to production now?")
  expect(rows[0]?.questions).toEqual([{ id: "q1", header: "Deploy", question: "Ship to production now?", options: ["Ship it", "Wait for review"], multi_select: false }])
  const token = rows[0]?.reply_token
  if (typeof token !== "string") throw new Error("the mirrored question has no reply token")
  const claim = await s.connectorStore.claimAnswer({ now: Date.now(), binding_id: s.bindingId as string, reply_token: token, answer: "Ship it" })
  expect(claim).toMatchObject({ kind: "ok", ui_request_kind: "question" })
}, 30_000)

test("#given a question that does not wait and has several parts #when it is mirrored #then blocking is false, options is null and every part is in questions", async () => {
  const s = await setup()
  await s.ask({
    requestId: "ask-multi",
    waitForAnswer: false,
    timeoutMs: 600_000,
    questions: [
      { id: "a", header: "Region", question: "Which region?", options: [{ label: "us-east" }, { label: "eu-west" }], multiSelect: false },
      { id: "b", header: "Notes", question: "Anything else?", options: [], multiSelect: false },
    ],
  })
  const [row] = await s.outbox()
  expect(row).toMatchObject({ event: "question", options: null, blocking: false })
  expect(row?.questions?.map((question) => question.id)).toEqual(["a", "b"])
}, 30_000)

test("#given a session with no binding #when it asks an ask_user question #then nothing is written for it", async () => {
  const s = await setup({ bind: false })
  // A connector has opened the store, so the mirror is not skipped for a missing store and a stray row would be visible.
  expect(await s.connectorStore.listBindings({ now: Date.now(), filter: {} })).toMatchObject({ kind: "ok", bindings: [] })
  expect(existsSync(gatewayDatabasePath(s.agentDir))).toBe(true)
  await s.ask()
  const db = new Database(gatewayDatabasePath(s.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT COUNT(*) AS n FROM outbox WHERE event_kind = 'question'").get()).toEqual({ n: 0 })
  } finally {
    db.close()
  }
}, 30_000)

test("#given a binding not subscribed to questions #when the session asks #then no question row is written", async () => {
  const s = await setup({ outboundEvents: ["report", "completion"] })
  await s.ask()
  expect((await s.outbox()).filter((row) => row.event === "question")).toEqual([])
}, 30_000)

test("#given the question was mirrored #when the model also relays it with thread_report #then the thread still has one row and the report returns that row, deduplicated", async () => {
  const s = await setup()
  await s.ask()
  const [mirrored] = await s.outbox()
  const reported = await s.report("ask-1")
  expect(reported).toMatchObject({ kind: "ok", cursor: mirrored?.cursor, reply_token: mirrored?.reply_token, deduplicated: true })
  expect(await s.outbox()).toHaveLength(1)
}, 30_000)

test("#given the model relayed the question first #when senpi's ask announcement is handled after it #then no second row is written", async () => {
  const s = await setup()
  const reported = await s.report("ask-1", { options: ["Ship it", "Wait for review"], blocking: true, ask_hint: "U123" })
  expect(reported).toMatchObject({ kind: "ok", deduplicated: false })
  await s.ask()
  const rows = await s.outbox()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ cursor: reported.cursor, text: "relayed ask-1", options: ["Ship it", "Wait for review"], blocking: true, ask_hint: "U123" })
}, 30_000)

test("#given a session bound to two threads #when it asks #then the mirror picks neither, and a report naming one thread owns the request even when a later report names the other", async () => {
  const s = await setup()
  const second = await s.sdk.bind({ session: "dur-1", binding: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "t2" } })
  if (second.kind !== "ok") throw new Error(JSON.stringify(second))
  await s.ask()
  expect(await s.outbox()).toEqual([])
  const first = await s.report("ask-1", { binding_id: s.bindingId })
  expect(first).toMatchObject({ kind: "ok", binding_id: s.bindingId, deduplicated: false })
  const other = await s.report("ask-1", { binding_id: second.binding.binding_id })
  expect(other).toMatchObject({ kind: "ok", binding_id: s.bindingId, cursor: first.cursor, reply_token: first.reply_token, deduplicated: true })
  const page = await s.connectorStore.readOutbox({ now: Date.now(), binding_id: second.binding.binding_id, after_cursor: 0, limit: 10 })
  expect(page).toMatchObject({ kind: "ok", rows: [] })
}, 30_000)

test("#given an ask_user request whose questions carry no ids #when it is mirrored #then each question gets its position as a stable id", async () => {
  const s = await setup()
  await s.ask({ requestId: "ask-noid", waitForAnswer: true, timeoutMs: 600_000, questions: [{ header: "A", question: "First?", options: [], multiSelect: false }, { id: "", header: "B", question: "Second?", options: [], multiSelect: false }] })
  const [row] = await s.outbox()
  expect(row?.questions?.map((question) => question.id)).toEqual(["q1", "q2"])
}, 30_000)

test("#given a store with many outbox rows #when a question write looks for an earlier row of its request #then it uses the question index, not a scan", async () => {
  const s = await setup()
  await s.ask()
  const db = new Database(gatewayDatabasePath(s.agentDir), { readonly: true })
  try {
    const plan = db.query("EXPLAIN QUERY PLAN SELECT binding_id, revision, cursor, reply_token FROM outbox WHERE session_durable_id = ? AND ui_request_id = ? AND event_kind = 'question' ORDER BY cursor LIMIT 1").all("dur-1", "ask-1") as { readonly detail: string }[]
    expect(plan.map((step) => step.detail).join(" | ")).toContain("outbox_question_request")
  } finally {
    db.close()
  }
}, 30_000)

test("#given two stores writing for the same request at once #when one mirrors and the other reports #then exactly one question row exists", async () => {
  const s = await setup()
  const [mirrored, reported] = await Promise.all([
    s.runtimeStore.mirrorQuestion({ now: Date.now(), session_durable_id: "dur-1", origin_delivery_ids: [], origin_local_input: false, ui_request_id: "ask-race", text: "mirrored", fields: { blocking: true } }),
    s.connectorStore.report({ now: Date.now(), receipt: null, session_durable_id: "dur-1", binding_id: null, origin_delivery_ids: [], event: "question", text: "reported", ui_request_id: "ask-race", ui_request_kind: "question" }),
  ])
  const rows = (await s.outbox()).filter((row) => row.event === "question")
  expect(rows).toHaveLength(1)
  const winner = rows[0]?.cursor
  expect(mirrored).toMatchObject({ cursor: winner })
  expect(reported).toMatchObject({ kind: "ok", cursor: winner })
  // Exactly one of the two wrote it; the other answered with that row.
  expect([mirrored.kind === "written", reported.kind === "ok" && reported.deduplicated === false].filter(Boolean)).toHaveLength(1)
}, 30_000)

test("#given a mirrored question #when the session answers it in its own client #then the row is closed and a later chat answer is already_answered", async () => {
  const s = await setup()
  await s.ask()
  const [row] = await s.outbox()
  s.closeLocally("ask-1")
  expect(s.closes).toHaveLength(1)
  await within(Promise.all(s.closes), "the local close")
  expect((await s.outbox())[0]).toMatchObject({ question_state: "answered" })
  const late = await s.sdk.answer({ binding_id: s.bindingId as string, reply_token: row?.reply_token as string, answer: "Ship it" })
  expect(late).toMatchObject({ kind: "error", error: { code: "already_answered" } })
}, 30_000)

test("#given a report that is not a question #when it carries options, blocking or ask_hint #then it is refused and nothing is written", async () => {
  const s = await setup()
  const refused = await s.report("ask-x", { kind: "report", request_id: undefined, request_kind: undefined, options: ["a"] })
  expect(refused).toMatchObject({ kind: "error", error: { code: "invalid_arguments", message: "Only a question carries options, blocking or ask_hint." } })
  expect(await s.outbox()).toEqual([])
  // The same report without them is written: the refusal was about the fields alone.
  expect(await s.report("ask-x", { kind: "report", request_id: undefined, request_kind: undefined })).toMatchObject({ kind: "ok" })
}, 30_000)

test("#given a question relayed before v11 #when the upgraded store reads it #then it reads as unknown (no options, blocking null) and a report row carries no render fields", async () => {
  const s = await setup()
  await s.report("ask-old")
  await s.report("none", { kind: "report", request_id: undefined, request_kind: undefined, text: "a result" })
  // Back to the v10 layout: the four v11 columns did not exist when these rows were written.
  await s.runtimeStore.dispose()
  await s.connectorStore.dispose()
  const db = new Database(gatewayDatabasePath(s.agentDir))
  try {
    db.run("DROP INDEX IF EXISTS outbox_question_request")
    for (const column of ["ask_hint", "blocking", "questions_json", "options_json"]) db.run(`ALTER TABLE outbox DROP COLUMN ${column}`)
    db.run("PRAGMA user_version = 10")
  } finally {
    db.close()
  }
  const upgraded = createGatewayStore({ agentDir: s.agentDir, instanceId: "upgrade-1" })
  cleanups.push(() => upgraded.dispose())
  const page = await upgraded.readOutbox({ now: Date.now(), binding_id: s.bindingId as string, after_cursor: 0, limit: 10 })
  if (page.kind !== "ok") throw new Error(JSON.stringify(page))
  const question = page.rows.find((row) => row.event === "question")
  const report = page.rows.find((row) => row.event === "report")
  expect(question).toMatchObject({ options: null, questions: null, blocking: null, ask_hint: null, question_state: "pending" })
  expect(report).toBeDefined()
  expect(report).not.toHaveProperty("options")
  expect(report).not.toHaveProperty("blocking")
  const check = new Database(gatewayDatabasePath(s.agentDir), { readonly: true })
  try {
    expect(check.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length })
  } finally {
    check.close()
  }
}, 30_000)

import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createThreadComponent } from "./component"
import type { RegisterControlEndpointOptions } from "./gateway/adapter"
import { gatewayOutboxMarkerPath } from "./gateway/paths"
import { createGatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

/**
 * A session relays a pending ask_user question to its bound chat thread (`thread_report` kind question
 * naming the request), then closes that question itself: answered in its own client, timed out or
 * cancelled. senpi announces every such end on its extension event bus (`ask-user/notify.js`
 * `emitAskUserClosed`). A connector holds the thread's later rows behind a pending question, so the
 * store must stop calling it pending, or the thread stays silent until someone answers it in chat.
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
    socket: "/tmp/thread-question-closed-legacy.sock",
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

async function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-question-closed-"))
  directories.push(agentDir)
  const runtimeStore = createGatewayStore({ agentDir, instanceId: "runtime-1" })
  const connectorStore = createGatewayStore({ agentDir, instanceId: "connector-1" })
  cleanups.push(() => runtimeStore.dispose(), () => connectorStore.dispose())
  /** Every close the session writes; a test awaits these writes, since the report's own insert also rewrites the marker naming its cursor. */
  const closes: Promise<number>[] = []
  const sessionStore: typeof runtimeStore = {
    ...runtimeStore,
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
  const bound = await sdk.bind({ session: "dur-1", binding: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "t1" } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const bindingId = bound.binding.binding_id
  let calls = 0
  /** The session's model calls thread_report for its ask_user request; `whileWriting` runs inside the call, as senpi interleaves events. */
  const relay = async (request: string, whileWriting?: () => void): Promise<{ readonly cursor: number; readonly reply_token: string }> => {
    const call = `call-${++calls}`
    const args = { kind: "question", text: `question for ${request}`, binding_id: bindingId, request_id: request, request_kind: "question" }
    await dispatch("tool_execution_start", { toolCallId: call, toolName: "thread_report", args })
    const tool = tools.find((entry) => entry.name === "thread_report")
    if (tool === undefined) throw new Error("thread_report is not registered")
    const result = ((await tool.execute(call, args, undefined, undefined, ctx)).details as { readonly result: { readonly kind: string; readonly cursor: number; readonly reply_token: string } }).result
    whileWriting?.()
    await dispatch("tool_execution_end", { toolCallId: call, toolName: "thread_report" })
    if (result.kind !== "ok") throw new Error(JSON.stringify(result))
    return result
  }
  /** senpi `emitAskUserClosed`. */
  const closeLocally = (request: string) => pi.events.emit("ask-user:closed", { requestId: request, status: "answered" })
  /** senpi `startQuestion` announcing a newly opened question (`ASK_USER_ASKED_EVENT`). */
  const askLocally = (request: string) => pi.events.emit("ask-user:asked", { request: { requestId: request } })
  /** The cursor the outbox marker names now. The store rewrites the marker inside the write's own transaction, so it is current once that write's promise settles. */
  const markerCursor = (): unknown => (JSON.parse(readFileSync(gatewayOutboxMarkerPath(agentDir), "utf8")) as { readonly cursor?: unknown }).cursor
  const question = async (cursor: number) => {
    const page = await connectorStore.readOutbox({ now: Date.now(), binding_id: bindingId, after_cursor: cursor - 1, limit: 1 })
    if (page.kind !== "ok") throw new Error(JSON.stringify(page))
    return page.rows[0]
  }
  return { sdk, bindingId, relay, closeLocally, askLocally, markerCursor, question, connectorStore, closes }
}

test("#given a session relayed two ask_user questions to its chat thread #when it answers one in its own client #then that question is no longer pending, a chat answer to it is already_answered, and the other stays pending", async () => {
  const s = await setup()
  const first = await s.relay("ask-1")
  const second = await s.relay("ask-2")
  s.closeLocally("ask-1")
  expect(s.closes).toHaveLength(1)
  await within(Promise.all(s.closes), "the local close")
  expect(s.markerCursor()).toBe(first.cursor)
  expect(await s.question(first.cursor)).toMatchObject({ event: "question", state: "pending", question_state: "answered", answered_by: null })
  expect(await s.question(second.cursor)).toMatchObject({ question_state: "pending" })
  const late = await s.sdk.answer({ binding_id: s.bindingId, reply_token: first.reply_token, answer: "option two" })
  expect(late).toMatchObject({ kind: "error", error: { code: "already_answered" } })
}, 30_000)

test("#given a relayed question #when a thread_answer claim is handed over and then lands #then a connector reading the outbox sees it in flight first and delivered after, with a marker for the change", async () => {
  const s = await setup()
  const asked = await s.relay("ask-claim")
  const claim = await s.connectorStore.claimAnswer({ now: Date.now(), binding_id: s.bindingId, reply_token: asked.reply_token, answer: "option two" })
  if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "answered", answer_state: "in_flight" })
  expect(await s.connectorStore.confirmAnswer({ reply_token: asked.reply_token, claimed_at: claim.claimed_at, answer: "option two" })).toBe(true)
  expect(s.markerCursor()).toBe(asked.cursor)
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "answered", answer_state: "delivered" })
}, 30_000)

test("#given a relayed question #when a thread_answer claim's hand-off fails and is released #then the connector reads it pending again, with a marker for the change", async () => {
  const s = await setup()
  const asked = await s.relay("ask-release")
  const claim = await s.connectorStore.claimAnswer({ now: Date.now(), binding_id: s.bindingId, reply_token: asked.reply_token, answer: "option two" })
  if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))
  expect(await s.connectorStore.releaseAnswer({ reply_token: asked.reply_token, claimed_at: claim.claimed_at })).toBe(true)
  expect(s.markerCursor()).toBe(asked.cursor)
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "pending", answer_state: null })
}, 30_000)

test("#given a thread_answer claim being handed over #when the session closes the question itself and the hand-off then fails #then the release does not reopen it and a later answer is already_answered", async () => {
  const s = await setup()
  const asked = await s.relay("ask-race")
  const claim = await s.connectorStore.claimAnswer({ now: Date.now(), binding_id: s.bindingId, reply_token: asked.reply_token, answer: "option two" })
  if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))
  s.closeLocally("ask-race")
  expect(s.closes).toHaveLength(1)
  await within(Promise.all(s.closes), "the local close")
  expect(s.markerCursor()).toBe(asked.cursor)
  expect(await s.connectorStore.releaseAnswer({ reply_token: asked.reply_token, claimed_at: claim.claimed_at })).toBe(false)
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "answered", answer_state: "delivered", answered_by: null })
  const late = await s.sdk.answer({ binding_id: s.bindingId, reply_token: asked.reply_token, answer: "option one" })
  expect(late).toMatchObject({ kind: "error", error: { code: "already_answered" } })
}, 30_000)

test("#given a thread_answer claim being handed over #when the session takes that relayed answer, announcing the close before the relay confirms #then the question keeps the relayed answer and its author", async () => {
  const s = await setup()
  const asked = await s.relay("ask-taken")
  const author = { platform_user_id: "U1", display: "Alice" }
  const claim = await s.connectorStore.claimAnswer({ now: Date.now(), binding_id: s.bindingId, reply_token: asked.reply_token, answer: "option two", answered_by: author })
  if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))
  s.closeLocally("ask-taken")
  expect(s.closes).toHaveLength(1)
  await within(Promise.all(s.closes), "the local close")
  expect(s.markerCursor()).toBe(asked.cursor)
  expect(await s.connectorStore.confirmAnswer({ reply_token: asked.reply_token, claimed_at: claim.claimed_at, answer: "option two", answered_by: author })).toBe(true)
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "answered", answer_state: "delivered", answered_by: author })
}, 30_000)

test("#given a session's ask_user question closes while its relay report is still being written #when the report finishes #then the row it wrote is closed too", async () => {
  const s = await setup()
  const written = await s.relay("ask-early", () => s.closeLocally("ask-early"))
  expect(s.closes).toHaveLength(1)
  await within(Promise.all(s.closes), "the close the finished report wrote")
  expect(await s.question(written.cursor)).toMatchObject({ question_state: "answered", answered_by: null })
}, 30_000)

test("#given a session's ask_user question closes before its relay report starts #when the report then runs #then the row it writes is closed and a chat answer to it is already_answered", async () => {
  const s = await setup()
  s.askLocally("ask-before")
  s.closeLocally("ask-before")
  const written = await s.relay("ask-before")
  expect(s.closes).toHaveLength(1)
  await within(Promise.all(s.closes), "the close the report wrote")
  expect(await s.question(written.cursor)).toMatchObject({ question_state: "answered", answered_by: null })
  const late = await s.sdk.answer({ binding_id: s.bindingId, reply_token: written.reply_token, answer: "option two" })
  expect(late).toMatchObject({ kind: "error", error: { code: "already_answered" } })
}, 30_000)

test("#given an ask_user request closed before any report #when a new question opens under the same request id and is reported #then the new row stays pending", async () => {
  const s = await setup()
  s.closeLocally("ask-reused")
  s.askLocally("ask-reused")
  const written = await s.relay("ask-reused")
  expect(s.closes).toHaveLength(0)
  expect(await s.question(written.cursor)).toMatchObject({ question_state: "pending", answer_state: null })
}, 30_000)

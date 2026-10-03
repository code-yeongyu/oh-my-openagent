import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, watch } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

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
  createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: runtimeStore }).register(pi as never, logger as never)
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
  /** Resolves once the outbox marker names `cursor` (the write the close makes); subscribe before the action that writes it. */
  const markerFor = (cursor: number) => {
    const marker = gatewayOutboxMarkerPath(agentDir)
    mkdirSync(dirname(marker), { recursive: true })
    return new Promise<void>((resolve) => {
      const watcher = watch(dirname(marker), (_event, name) => {
        if (name !== basename(marker)) return
        let named: unknown
        try {
          named = (JSON.parse(readFileSync(marker, "utf8")) as { readonly cursor?: unknown }).cursor
        } catch {
          return
        }
        if (named !== cursor) return
        watcher.close()
        resolve()
      })
    })
  }
  const question = async (cursor: number) => {
    const page = await connectorStore.readOutbox({ now: Date.now(), binding_id: bindingId, after_cursor: cursor - 1, limit: 1 })
    if (page.kind !== "ok") throw new Error(JSON.stringify(page))
    return page.rows[0]
  }
  return { sdk, bindingId, relay, closeLocally, markerFor, question, connectorStore }
}

test("#given a session relayed two ask_user questions to its chat thread #when it answers one in its own client #then that question is no longer pending, a chat answer to it is already_answered, and the other stays pending", async () => {
  const s = await setup()
  const first = await s.relay("ask-1")
  const second = await s.relay("ask-2")
  const marker = s.markerFor(first.cursor)
  s.closeLocally("ask-1")
  await within(marker, "the outbox marker after the local close")
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
  const marker = s.markerFor(asked.cursor)
  expect(await s.connectorStore.confirmAnswer({ reply_token: asked.reply_token, claimed_at: claim.claimed_at, answer: "option two" })).toBe(true)
  await within(marker, "the outbox marker after the answer was delivered")
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "answered", answer_state: "delivered" })
}, 30_000)

test("#given a relayed question #when a thread_answer claim's hand-off fails and is released #then the connector reads it pending again, with a marker for the change", async () => {
  const s = await setup()
  const asked = await s.relay("ask-release")
  const claim = await s.connectorStore.claimAnswer({ now: Date.now(), binding_id: s.bindingId, reply_token: asked.reply_token, answer: "option two" })
  if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))
  const marker = s.markerFor(asked.cursor)
  expect(await s.connectorStore.releaseAnswer({ reply_token: asked.reply_token, claimed_at: claim.claimed_at })).toBe(true)
  await within(marker, "the outbox marker after the claim was released")
  expect(await s.question(asked.cursor)).toMatchObject({ question_state: "pending", answer_state: null })
}, 30_000)

test("#given a session's ask_user question closes while its relay report is still being written #when the report finishes #then the row it wrote is closed too", async () => {
  const s = await setup()
  // The report writes the first row of this store, so its cursor is 1; the close rewrites the marker naming it again.
  const marker = { wait: undefined as Promise<void> | undefined }
  const written = await s.relay("ask-early", () => {
    marker.wait = s.markerFor(1)
    s.closeLocally("ask-early")
  })
  expect(written.cursor).toBe(1)
  await within(marker.wait ?? Promise.reject(new Error("no marker wait")), "the outbox marker after the report finished")
  expect(await s.question(written.cursor)).toMatchObject({ question_state: "answered", answered_by: null })
}, 30_000)

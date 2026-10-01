import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createThreadComponent } from "./component"
import type { AdmitExternalMessageInput, RegisterControlEndpointOptions } from "./gateway/adapter"
import { SESSION_CONTROL_DELIVERY_TYPE } from "./gateway/constants"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

/**
 * A session bound to two chat threads reports (or arms its completion) without naming a binding. The
 * default is the thread whose message the CURRENT run consumed: the runtime below emits the extension
 * events of the pinned senpi engine (2026.9.30 `agent-session.js` / `external-admission.js`) in its
 * order. A `started` delivery enters the run as a `session_control_delivery` custom message; a
 * `queued` one waits in the follow-up queue and is drained after the model's final answer, as a new
 * run (`agent_end`, then `agent_start`) WITHOUT an `agent_settled` in between - one message at a
 * time, or all at once under `followUpMode: "all"`. The runtime and the connector use separate stores
 * on one agent dir, as two processes do.
 */

const HOST_SOCKET = "/tmp/i-fedcba9876543210.sock"
const EVENT_WAIT_MS = 10_000
const directories: string[] = []
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Handler = (payload: unknown, ctx?: unknown) => unknown
type Drain = RegisterControlEndpointOptions["drain"]
type CapturedTool = { readonly name: string; readonly execute: (id: string, args: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ readonly details?: unknown }> }
type ToolOutcome = { readonly kind: string; readonly binding_id?: string; readonly armed?: boolean; readonly error?: { readonly code: string; readonly details?: { readonly binding_ids?: readonly string[] } } }
type EngineMessage = Record<string, unknown>

function host(drain: () => Drain): ThreadHost {
  const session: ThreadHostSession = { sessionId: "rpc-1", durableSessionId: "dur-1", cwd: process.cwd(), name: "lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-report-origin-legacy.sock",
    listSessions: async () => [session],
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
    gateway: { wake: async (_endpoint, ids) => (await drain()({ type: "session_control_wake", reason: "command", reasons: ["command"], ...(ids.length > 0 ? { delivery_ids: ids } : {}) })) ?? { admitted: [] } },
  }
}

/** senpi `external-admission.js` `deliveryMessage`: the message a delivery becomes in the run. */
function deliveryMessage(input: AdmitExternalMessageInput): EngineMessage {
  return { role: "custom", customType: SESSION_CONTROL_DELIVERY_TYPE, content: input.text, display: true, details: { delivery_id: input.delivery_id, source: "session_control", deliverAs: input.deliverAs }, timestamp: 0 }
}

const userMessage = (text: string): EngineMessage => ({ role: "user", content: [{ type: "text", text }], timestamp: 0 })
const toolCallMessage = (id: string): EngineMessage => ({ role: "assistant", content: [{ type: "toolCall", id, name: "thread_report", arguments: {} }], stopReason: "toolUse", timestamp: 0 })
const toolResultMessage = (id: string): EngineMessage => ({ role: "toolResult", toolCallId: id, toolName: "thread_report", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 0 })
const finalAnswer: EngineMessage = { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: 0 }

function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${EVENT_WAIT_MS} ms for ${what}`)), EVENT_WAIT_MS)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

function completionsWritten(store: GatewayStore): Promise<void> {
  return new Promise((resolve) => {
    const stop = store.onEvent((event) => {
      if (event.kind !== "completions_emitted") return
      stop()
      resolve()
    })
  })
}

async function setup(options: { readonly followUpMode?: "one-at-a-time" | "all" } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-report-origin-"))
  directories.push(agentDir)
  const runtimeStore = createGatewayStore({ agentDir, instanceId: "runtime-1" })
  const connectorStore = createGatewayStore({ agentDir, instanceId: "connector-1" })
  cleanups.push(() => runtimeStore.dispose(), () => connectorStore.dispose())
  const handlers = new Map<string, Handler[]>()
  const tools: CapturedTool[] = []
  let drain: Drain | undefined
  const engine = { running: false, start: undefined as EngineMessage | undefined, followUps: [] as EngineMessage[], pending: new Set<string>(), emitted: new Set<string>(), calls: 0 }
  const busy = () => engine.running || engine.start !== undefined
  const session = {
    persistHeaderNow: async () => undefined,
    registerControlEndpoint: async (registration: RegisterControlEndpointOptions) => {
      drain = registration.drain
      return { status: "registered", socket: HOST_SOCKET, dispose: async () => undefined }
    },
    admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 1 }),
    admitExternalMessage: (input: AdmitExternalMessageInput) => {
      if (engine.pending.has(input.delivery_id) || engine.emitted.has(input.delivery_id)) return { kind: "already_admitted", turn_epoch: 1 }
      engine.pending.add(input.delivery_id)
      if (!busy()) {
        engine.start = deliveryMessage(input)
        return { kind: "started", turn_epoch: 1 }
      }
      engine.followUps.push(deliveryMessage(input))
      return { kind: "queued", turn_epoch: 1 }
    },
    listAdmittedDeliveries: () => ({ pending: [...engine.pending], emitted: [...engine.emitted] }),
  }
  const pi = { cwd: process.cwd(), session, registerTool(tool: CapturedTool) { tools.push(tool) }, on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {} }
  const ctx = { sessionManager: { getSessionId: () => "dur-1", getSessionFile: () => join(agentDir, "dur-1.jsonl") }, isIdle: () => !busy() }
  const dispatch = async (event: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx)
  }
  const message = async (entry: EngineMessage) => {
    await dispatch("message_start", { message: entry })
    await dispatch("message_end", { message: entry })
    const details = entry.details as { readonly delivery_id?: string } | undefined
    if (details?.delivery_id !== undefined && engine.pending.delete(details.delivery_id)) engine.emitted.add(details.delivery_id)
  }
  const registered = () => {
    if (drain === undefined) throw new Error("the component registered no control endpoint")
    return drain
  }
  const logger = { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } }
  createThreadComponent({ host: host(registered), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: runtimeStore }).register(pi as never, logger as never)
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host: host(registered), store: connectorStore })
  cleanups.push(() => sdk.dispose())
  await dispatch("session_start")
  registered()

  const bindThread = async (chat: string) => {
    const bound = await sdk.bind({ session: "dur-1", binding: { platform: "custom", account_id: "bot", chat_id: chat, thread_id: "t1" } })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    return bound.binding.binding_id
  }
  const send = async (bindingId: string, text: string) => await sdk.send({ binding_id: bindingId, text, idempotency_key: `evt-${text}` })
  const callReport = async (kind: "report" | "completion", text: string): Promise<ToolOutcome> => {
    const id = `call-${++engine.calls}`
    await message(toolCallMessage(id))
    const tool = tools.find((entry) => entry.name === "thread_report")
    if (tool === undefined) throw new Error("thread_report is not registered")
    const details = (await tool.execute(id, { kind, text }, undefined, undefined, ctx)).details as { readonly result: ToolOutcome }
    await message(toolResultMessage(id))
    return details.result
  }
  /** senpi `_promptAgent`: the delivery admitted as `started` begins the run and is its first message. */
  const runStartedDelivery = async () => {
    const start = engine.start
    if (start === undefined) throw new Error("no delivery was admitted as started")
    engine.start = undefined
    engine.running = true
    await dispatch("agent_start")
    await dispatch("turn_start")
    await message(start)
  }
  const runLocalPrompt = async (text: string) => {
    engine.running = true
    await dispatch("agent_start")
    await dispatch("turn_start")
    await message(userMessage(text))
  }
  /**
   * The model's final answer (no tool call). With follow-ups queued, senpi's `agent_end` handler
   * schedules the continuation instead of settling: a new run takes the next follow-up (or all of
   * them), and `agent_settled` does not fire. `local` is a prompt the user queued in the terminal.
   */
  const answerAndContinue = async (local?: string) => {
    await message(finalAnswer)
    await dispatch("agent_end", { messages: [finalAnswer] })
    const next = local !== undefined ? [userMessage(local)] : options.followUpMode === "all" ? engine.followUps.splice(0) : engine.followUps.splice(0, 1)
    if (next.length === 0) throw new Error("nothing is queued to continue with")
    await dispatch("agent_start")
    await dispatch("turn_start")
    for (const entry of next) await message(entry)
  }
  const answerAndSettle = async () => {
    await message(finalAnswer)
    await dispatch("agent_end", { messages: [finalAnswer] })
    engine.running = false
    await dispatch("agent_settled")
  }
  const texts = async (bindingId: string) => {
    const page = await connectorStore.readOutbox({ now: Date.now(), binding_id: bindingId })
    return page.kind === "ok" ? page.rows.map((row) => `${row.event}:${row.text}`) : []
  }
  return { bindThread, send, callReport, runStartedDelivery, runLocalPrompt, answerAndContinue, answerAndSettle, texts, written: () => completionsWritten(runtimeStore) }
}

describe("a report or completion without binding_id goes to the thread whose message the current run consumed", () => {
  test("#given threads A and B bound to one session #when A's message starts the run and B's is queued behind it #then A's report and A's completion land in A only, and after the run a report must name a binding", async () => {
    const s = await setup()
    const a = await s.bindThread("chat-a")
    const b = await s.bindThread("chat-b")
    expect(await s.send(a, "please do the job")).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
    await s.runStartedDelivery()
    expect(await s.send(b, "and what about me")).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
    expect(await s.callReport("report", "halfway there")).toMatchObject({ kind: "ok", binding_id: a })
    expect(await s.callReport("completion", "job done")).toMatchObject({ kind: "ok", binding_id: a, armed: true })
    const written = s.written()
    await s.answerAndSettle()
    await within(written, "the armed completion to be written at the settle")
    expect({ a: await s.texts(a), b: await s.texts(b) }).toEqual({ a: ["report:halfway there", "completion:job done"], b: [] })
    expect(await s.callReport("report", "no run now")).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })

  test("#given A's run with B's message queued behind it #when the engine drains B's follow-up before the session settles #then the report and completion answering B land in B, not A", async () => {
    const s = await setup()
    const a = await s.bindThread("chat-a")
    const b = await s.bindThread("chat-b")
    await s.send(a, "please do the job")
    await s.runStartedDelivery()
    expect(await s.send(b, "and what about me")).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
    expect(await s.callReport("report", "A is done")).toMatchObject({ kind: "ok", binding_id: a })
    await s.answerAndContinue()
    expect(await s.callReport("report", "answering B")).toMatchObject({ kind: "ok", binding_id: b })
    expect(await s.callReport("completion", "B is done")).toMatchObject({ kind: "ok", binding_id: b, armed: true })
    const written = s.written()
    await s.answerAndSettle()
    await within(written, "the armed completion to be written at the settle")
    expect({ a: await s.texts(a), b: await s.texts(b) }).toEqual({ a: ["report:A is done"], b: ["report:answering B", "completion:B is done"] })
  })

  test("#given messages from A and B queued behind A's run #when the engine drains both into one run (followUpMode all) #then a report or completion without binding_id is refused naming both bindings, and nothing is written", async () => {
    const s = await setup({ followUpMode: "all" })
    const a = await s.bindThread("chat-a")
    const b = await s.bindThread("chat-b")
    await s.send(a, "please do the job")
    await s.runStartedDelivery()
    await s.send(b, "and what about me")
    await s.send(a, "one more thing")
    await s.answerAndContinue()
    const refused = await s.callReport("report", "whose answer?")
    expect(refused).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect([...(refused.error?.details?.binding_ids ?? [])].sort()).toEqual([a, b].sort())
    expect(await s.callReport("completion", "whose completion?")).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect({ a: await s.texts(a), b: await s.texts(b) }).toEqual({ a: [], b: [] })
  })

  test("#given threads A and B bound to one session #when a run starts from a prompt typed in the terminal, or continues with one after A's answer #then a report without binding_id is refused instead of going to A", async () => {
    const s = await setup()
    const a = await s.bindThread("chat-a")
    const b = await s.bindThread("chat-b")
    await s.runLocalPrompt("look at the logs")
    expect(await s.callReport("report", "typed locally")).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    await s.answerAndSettle()
    await s.send(a, "please do the job")
    await s.runStartedDelivery()
    expect(await s.callReport("report", "A's step")).toMatchObject({ kind: "ok", binding_id: a })
    await s.answerAndContinue("now summarize it for me")
    expect(await s.callReport("report", "after the local follow-up")).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(await s.callReport("completion", "local run done")).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect({ a: await s.texts(a), b: await s.texts(b) }).toEqual({ a: ["report:A's step"], b: [] })
  })

  test("#given a session with one active outbound binding #when it reports outside a run started by a bound message #then the report goes to that binding", async () => {
    const s = await setup()
    const only = await s.bindThread("chat-only")
    expect(await s.callReport("report", "typed in the terminal")).toMatchObject({ kind: "ok", binding_id: only })
    expect(await s.texts(only)).toEqual(["report:typed in the terminal"])
  })
})

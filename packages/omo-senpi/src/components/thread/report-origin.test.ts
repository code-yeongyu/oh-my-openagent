import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createThreadComponent } from "./component"
import type { RegisterControlEndpointOptions } from "./gateway/adapter"
import { createGatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

/**
 * A session bound to two chat threads reports without naming a binding. The report goes to the
 * thread whose message started the current run, even after the other thread's message arrived
 * mid-run (queued behind the turn). The runtime and the connector use separate stores on one agent
 * dir, as two processes do.
 */

const HOST_SOCKET = "/tmp/i-fedcba9876543210.sock"
const directories: string[] = []
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Handler = (payload: unknown, ctx?: unknown) => unknown
type Drain = RegisterControlEndpointOptions["drain"]
type CapturedTool = { readonly name: string; readonly execute: (id: string, args: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ readonly details?: unknown }> }

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

async function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-report-origin-"))
  directories.push(agentDir)
  const runtimeStore = createGatewayStore({ agentDir, instanceId: "runtime-1" })
  const connectorStore = createGatewayStore({ agentDir, instanceId: "connector-1" })
  cleanups.push(() => runtimeStore.dispose(), () => connectorStore.dispose())
  const handlers = new Map<string, Handler[]>()
  const tools: CapturedTool[] = []
  let drain: Drain | undefined
  let running = false
  const session = {
    persistHeaderNow: async () => undefined,
    registerControlEndpoint: async (options: RegisterControlEndpointOptions) => {
      drain = options.drain
      return { status: "registered", socket: HOST_SOCKET, dispose: async () => undefined }
    },
    admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 1 }),
    admitExternalMessage: () => ({ kind: running ? "queued" : "started", turn_epoch: 1 }),
    listAdmittedDeliveries: () => ({ pending: [], emitted: [] }),
  }
  const pi = { cwd: process.cwd(), session, registerTool(tool: CapturedTool) { tools.push(tool) }, on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {} }
  const ctx = { sessionManager: { getSessionId: () => "dur-1", getSessionFile: () => join(agentDir, "dur-1.jsonl") }, isIdle: () => !running }
  const dispatch = async (event: string) => { for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx) }
  const registered = () => {
    if (drain === undefined) throw new Error("the component registered no control endpoint")
    return drain
  }
  const logger = { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } }
  createThreadComponent({ host: host(registered), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store: runtimeStore }).register(pi as never, logger as never)
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host: host(registered), store: connectorStore })
  cleanups.push(() => sdk.dispose())
  const bindThread = async (chat: string) => {
    const bound = await sdk.bind({ session: "dur-1", binding: { platform: "custom", account_id: "bot", chat_id: chat, thread_id: "t1" } })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    return bound.binding.binding_id
  }
  await dispatch("session_start")
  registered()
  const report = async (text: string) => {
    const tool = tools.find((entry) => entry.name === "thread_report")
    if (tool === undefined) throw new Error("thread_report is not registered")
    const details = (await tool.execute(`call-${text}`, { kind: "report", text }, undefined, undefined, ctx)).details as { readonly result: { readonly kind: string; readonly binding_id?: string; readonly error?: { readonly code: string } } }
    return details.result
  }
  const texts = async (bindingId: string) => {
    const page = await connectorStore.readOutbox({ now: Date.now(), binding_id: bindingId })
    return page.kind === "ok" ? page.rows.map((row) => row.text) : []
  }
  const startRun = async () => {
    running = true
    await dispatch("agent_start")
  }
  const settle = async () => {
    running = false
    await dispatch("agent_settled")
  }
  return { sdk, bindThread, report, texts, startRun, settle }
}

describe("a report without binding_id goes to the thread whose message started the run", () => {
  test("#given threads A and B bound to one session #when A's message starts the run and B's arrives mid-run #then the report lands in A only, and after the run it must name a binding", async () => {
    const { sdk, bindThread, report, texts, startRun, settle } = await setup()
    const a = await bindThread("chat-a")
    const b = await bindThread("chat-b")
    const fromA = await sdk.send({ binding_id: a, text: "please do the job", idempotency_key: "evt-a" })
    expect(fromA).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
    await startRun()
    const fromB = await sdk.send({ binding_id: b, text: "and what about me", idempotency_key: "evt-b" })
    expect(fromB).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
    expect(await report("halfway there")).toMatchObject({ kind: "ok", binding_id: a })
    expect({ a: await texts(a), b: await texts(b) }).toEqual({ a: ["halfway there"], b: [] })
    await settle()
    expect(await report("no run now")).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })

  test("#given a session with one active outbound binding #when it reports outside a run started by a bound message #then the report goes to that binding", async () => {
    const { bindThread, report, texts } = await setup()
    const only = await bindThread("chat-only")
    expect(await report("typed in the terminal")).toMatchObject({ kind: "ok", binding_id: only })
    expect(await texts(only)).toEqual(["typed in the terminal"])
  })
})

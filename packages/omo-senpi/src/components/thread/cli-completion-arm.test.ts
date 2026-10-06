import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createThreadComponent } from "./component"
import type { RegisterControlEndpointOptions } from "./gateway/adapter"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

/**
 * A completion armed from outside the session (`omo thread report <s> completion`, the thread SDK)
 * reaches a RUNNING session: the SDK wakes the session's endpoint, the component reads the durable
 * arm on that `wake` command edge, and the session's next settle writes the completion with that
 * run's outcome. The runtime and the CLI use separate store instances on one agent dir, as two
 * processes do.
 */

const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"
/** Registration records the session's incarnation in the store first; past this bound it never happened. */
const ENDPOINT_WAIT_MS = 3_000

/** Awaits `work`, failing with what was awaited once `ms` pass: a circuit breaker, not a sleep. */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}`)), ms) })])
  } finally {
    clearTimeout(timer)
  }
}
const directories: string[] = []
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Handler = (payload: unknown, ctx?: unknown) => unknown
type Drain = RegisterControlEndpointOptions["drain"]

function runtime(agentDir: string, store: GatewayStore) {
  const handlers = new Map<string, Handler[]>()
  let drain: Drain | undefined
  // Registration runs off the session_start path (it records the incarnation first), so a test waits for this edge.
  let endpointRegistered: () => void = () => undefined
  const endpointReady = new Promise<void>((resolve) => { endpointRegistered = resolve })
  const session = {
    persistHeaderNow: async () => undefined,
    registerControlEndpoint: async (options: RegisterControlEndpointOptions) => {
      drain = options.drain
      endpointRegistered()
      return { status: "registered", socket: HOST_SOCKET, dispose: async () => undefined }
    },
    admissionGate: () => ({ can_admit: true, editor_revision: 0, turn_epoch: 0 }),
    admitExternalMessage: () => ({ kind: "started", turn_epoch: 1 }),
    listAdmittedDeliveries: () => ({ pending: [], emitted: [] }),
  }
  const pi = { cwd: process.cwd(), sessionContext: { host_instance: "runtime-1" }, session, registerTool() {}, on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {} }
  const ctx = { sessionManager: { getSessionId: () => "dur-1", getSessionFile: () => join(agentDir, "dur-1.jsonl") }, isIdle: () => true }
  const dispatch = async (event: string, payload: Record<string, unknown> = {}) => { for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx) }
  const logger = { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } }
  createThreadComponent({ host: sdkHost(() => undefined), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(pi as never, logger as never)
  const registered = () => {
    if (drain === undefined) throw new Error("the component registered no control endpoint")
    return drain
  }
  const run = async (stopReason: string) => {
    await dispatch("agent_start")
    await dispatch("agent_end", { messages: [{ role: "assistant", stopReason }] })
    await dispatch("agent_settled")
  }
  return { dispatch, registered, endpointReady, run }
}

type WakeEdge = { readonly reason: "command" | "idle"; readonly reasons: readonly ("command" | "idle")[] }
const COMMAND_WAKE: WakeEdge = { reason: "command", reasons: ["command"] }

function sdkHost(onWake: () => Drain | undefined, edge: WakeEdge = COMMAND_WAKE): ThreadHost {
  const session: ThreadHostSession = { sessionId: "rpc-1", durableSessionId: "dur-1", cwd: process.cwd(), name: "lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-cli-arm-legacy.sock",
    listSessions: async () => [session],
    listTarget: async (id, endpoint) => {
      const sessions = [session].filter((row) => row.durableSessionId === id).map((row) => ({ ...row, socket: endpoint.socket, endpoint_kind: endpoint.kind }))
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
    gateway: {
      wake: async (_endpoint, ids) => {
        const drain = onWake()
        if (drain === undefined) throw new Error("host_unavailable:/tmp/i-0123456789abcdef.sock")
        return (await drain({ type: "session_control_wake", ...edge, ...(ids.length > 0 ? { delivery_ids: ids } : {}) })) ?? { admitted: [] }
      },
    },
  }
}

async function setup(options: { readonly wakeReachesSession: boolean; readonly edge?: WakeEdge }) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-cli-arm-"))
  directories.push(agentDir)
  const runtimeStore = createGatewayStore({ agentDir, instanceId: "runtime-1" })
  const cliStore = createGatewayStore({ agentDir, instanceId: "cli-1" })
  cleanups.push(() => runtimeStore.dispose(), () => cliStore.dispose())
  const target = runtime(agentDir, runtimeStore)
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host: sdkHost(() => (options.wakeReachesSession ? target.registered() : undefined), options.edge), store: cliStore })
  cleanups.push(() => sdk.dispose())
  const bound = await sdk.bind({ session: "dur-1", binding: { platform: "custom", account_id: "bot", chat_id: "c1", thread_id: "t1", outbound_events: ["completion"] } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  await target.dispatch("session_start")
  await within(target.endpointReady, ENDPOINT_WAIT_MS, "the component to call registerControlEndpoint on session_start")
  // The store worker is serial: this read returns after the session_start pickup's read, so that
  // pickup has seen no arm and only the wake edge can arm the tracker for the report below.
  expect(await runtimeStore.pendingCompletionArms("dur-1")).toBe(0)
  const rows = async () => {
    const page = await cliStore.readOutbox({ now: Date.now(), binding_id: bound.binding.binding_id })
    return page.kind === "ok" ? page.rows.map((row) => ({ event: row.event, outcome: row.outcome, text: row.text })) : []
  }
  return { sdk, target, bindingId: bound.binding.binding_id, rows, pending: () => cliStore.pendingCompletionArms("dur-1") }
}

describe("a completion armed from the CLI reaches the running session", () => {
  test("#given a running session #when the CLI arms a completion #then the session's next settle writes exactly one row with that run's outcome, and later settles add none", async () => {
    // given
    const { sdk, target, bindingId, rows, pending } = await setup({ wakeReachesSession: true })
    // when
    const armed = await sdk.report({ session: "dur-1", kind: "completion", text: "cli done", binding_id: bindingId })
    await target.run("error")
    // then
    expect(armed).toMatchObject({ kind: "ok", armed: true })
    expect(await rows()).toEqual([{ event: "completion", outcome: "failed", text: "cli done" }])
    expect(await pending()).toBe(0)
    await target.run("stop")
    expect(await rows()).toHaveLength(1)
  })

  test("#given the CLI's wake coalesced with an idle edge #when senpi reports reason idle with command only in reasons #then the arm is still picked up and the next settle writes it", async () => {
    // given
    const { sdk, target, bindingId, rows } = await setup({ wakeReachesSession: true, edge: { reason: "idle", reasons: ["idle", "command"] } })
    // when
    await sdk.report({ session: "dur-1", kind: "completion", text: "cli done", binding_id: bindingId })
    await target.run("stop")
    // then
    expect(await rows()).toEqual([{ event: "completion", outcome: "completed", text: "cli done" }])
  })

  test("#given a wake that does not reach the session #when the CLI arms a completion #then the report still answers armed and the durable arm waits for the session's next start", async () => {
    // given
    const { sdk, target, bindingId, rows, pending } = await setup({ wakeReachesSession: false })
    // when
    const armed = await sdk.report({ session: "dur-1", kind: "completion", text: "cli done", binding_id: bindingId })
    await target.run("stop")
    // then
    expect(armed).toMatchObject({ kind: "ok", armed: true })
    expect({ rows: await rows(), pending: await pending() }).toEqual({ rows: [], pending: 1 })
  })
})

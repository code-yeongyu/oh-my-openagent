import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadComponent } from "./component"
import { gatewayInboxDirectory } from "./gateway/paths"
import { createGatewayStore } from "./gateway/store"
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
function eventApi(session?: Record<string, unknown>) {
  const handlers = new Map<string, Handler[]>()
  const pi = { cwd: process.cwd(), registerTool() {}, on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {}, ...(session === undefined ? {} : { session }) }
  const dispatch = async (event: string, ctx?: unknown) => { for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx) }
  return { pi, handlers, dispatch }
}

describe("thread component control endpoint registration", () => {
  test("#given an engine without pi.session #when the component registers #then no control endpoint is registered and only the run and shutdown hooks exist", () => {
    const f = eventApi()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state", agentDir: () => "/tmp/thread-test-agent" }).register(f.pi as never, context([]) as never)
    expect([...f.handlers.keys()].sort()).toEqual(["agent_end", "agent_settled", "agent_start", "session_shutdown"])
  })

  test("#given a completion armed through a binding #when agent_end fires and then the session settles #then exactly one completion row appears, only after the settle", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-component-completion-"))
    const store = createGatewayStore({ agentDir })
    try {
      const f = eventApi()
      createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(f.pi as never, context([]) as never)
      const bound = await store.bind({ now: Date.now(), receipt: null, binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", root_message_id: null, progress_message_id: null, session_durable_id: "dur-1", direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["completion"], policy_id: "default", ttl_seconds: null } })
      if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
      await store.report({ now: Date.now(), receipt: null, session_durable_id: "dur-1", binding_id: bound.binding.binding_id, event: "completion", text: "all done", ui_request_id: null })
      const ctx = { sessionManager: { getSessionId: () => "dur-1" } }
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

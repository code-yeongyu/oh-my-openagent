import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadComponent } from "./component"
import { gatewayInboxDirectory } from "./gateway/paths"
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
  test("#given an engine without pi.session #when the component registers #then it hooks no session lifecycle event", () => {
    const f = eventApi()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect([...f.handlers.keys()]).toEqual([])
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

describe("thread component production registration", () => {
  test("registers all nine tools when a test host is supplied", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools.map((tool) => tool.name)).toEqual(["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff", "thread_rename", "thread_set_model", "thread_set_reasoning"])
  })

  test("registers the family regardless of the context flag", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools.map((tool) => tool.name)).toEqual(["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff", "thread_rename", "thread_set_model", "thread_set_reasoning"])
  })

  test("registers all nine tools when a test host is supplied and no host flag exists", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools).toHaveLength(9)
  })
})

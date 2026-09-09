import { describe, expect, test } from "bun:test"
import { createThreadComponent } from "./component"
import type { ThreadHost } from "./tools"

function host(): ThreadHost {
  return { socket: "/tmp/thread-test.sock", listSessions: async () => [], openSession: async () => ({ sessionId: "s", cwd: process.cwd() }), getMessages: async () => [], getState: async () => ({}), prompt: async () => ({}), interrupt: async () => ({}) }
}
function context(warnings: string[], sharedHostEnabled = true) { return { logger: { info() {}, error() {}, warn(message: string) { warnings.push(message) } }, config: { getFlag: () => undefined }, sharedHostEnabled } }
function api() { const tools: Record<string, unknown>[] = []; return { tools, pi: { cwd: process.cwd(), rpc: { emit() {}, handle() {} }, registerTool(tool: Record<string, unknown>) { tools.push(tool) }, on() {}, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {} } } }

describe("thread component production registration", () => {
  test("registers all six tools when a test host is supplied", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools.map((tool) => tool.name)).toEqual(["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff"])
  })

  test("does not register tools when shared host is disabled", () => {
    const warnings: string[] = []; const f = api(); const previous = process.env.SENPI_RPC_SOCKET
    process.env.SENPI_RPC_SOCKET = "/definitely/missing/thread.sock"
    try { createThreadComponent().register(f.pi as never, context(warnings, false) as never) } finally { if (previous === undefined) delete process.env.SENPI_RPC_SOCKET; else process.env.SENPI_RPC_SOCKET = previous }
    expect(f.tools).toHaveLength(0); expect(warnings).toHaveLength(0)
  })

  test("registers all six tools when shared host is enabled", () => {
    const f = api()
    createThreadComponent({ host: host(), stateDirectory: "/tmp/thread-test-state" }).register(f.pi as never, context([]) as never)
    expect(f.tools).toHaveLength(6)
  })
})

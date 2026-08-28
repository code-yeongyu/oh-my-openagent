import { describe, expect, test } from "bun:test"
import { createThreadComponent } from "./component"

function ctx(logs: string[]) { return { logger: { info() {}, error() {}, warn(message: string) { logs.push(message) } }, config: { getFlag: () => undefined } } }
function pi(request?: (name: string, data?: unknown) => Promise<unknown>) { const tools: Record<string, unknown>[] = []; return { tools, pi: { cwd: process.cwd(), rpc: request === undefined ? undefined : { request }, registerTool(tool: Record<string, unknown>) { tools.push(tool) }, on() {}, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {} } } }

describe("thread component production registration", () => {
  test("constructs the live surface from pi.rpc and registers all six tools", () => {
    const seen: string[] = []
    const f = pi(async (name) => { seen.push(name); if (name === "list_sessions") return { sessions: [] }; throw new Error(`unexpected ${name}`) })
    createThreadComponent().register(f.pi as never, ctx([]) as never)
    expect(f.tools.map((tool) => tool.name)).toEqual(["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff"])
    expect(seen).toEqual([])
  })

  test("warns when the runtime RPC surface is unavailable", () => {
    const logs: string[] = []; const f = pi()
    createThreadComponent().register(f.pi as never, ctx(logs) as never)
    expect(f.tools).toHaveLength(0); expect(logs).toEqual(["omo-senpi thread component skipped: live RPC surface unavailable"])
  })
})

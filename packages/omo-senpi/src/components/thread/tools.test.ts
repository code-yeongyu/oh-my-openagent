import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadTools, registerThreadTools, type ThreadHost } from "./tools"

function fixture() {
  const session = { sessionId: "route-peer", durableSessionId: "dur-peer", cwd: process.cwd(), name: "peer", status: "open" as const }
  const host: ThreadHost = {
    socket: "/tmp/thread-tools-test.sock",
    listSessions: async () => [session],
    openSession: async () => session,
    getMessages: async () => [{ role: "user", content: "hello" }],
    getState: async () => ({ isStreaming: false }),
    prompt: async () => ({ turnId: "turn-1" }),
    interrupt: async () => ({ interrupted: false }),
  }
  return { host, stateDirectory: mkdtempSync(join(tmpdir(), "thread-tools-registration-")) }
}

describe("thread tool registration", () => {
  test("registers exactly the six contract tools with search metadata", () => {
    const tools: Record<string, unknown>[] = []
    const f = fixture()
    registerThreadTools({ registerTool: (tool) => tools.push(tool) }, { ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    expect(tools.map((tool) => tool.name)).toEqual(["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff"])
    expect(tools.every((tool) => tool.exposure === "search" && tool.searchGroup === "threads")).toBe(true)
  })

  test("unknown targets return the typed not_found result", async () => {
    const f = fixture()
    const list = createThreadTools({ ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    const result = await list[2].execute("call-1", { thread: "missing" }, undefined, undefined, undefined)
    expect((result.details as { result: { kind: string; error?: { code: string } } }).result).toMatchObject({ kind: "error", error: { code: "not_found" } })
  })
})

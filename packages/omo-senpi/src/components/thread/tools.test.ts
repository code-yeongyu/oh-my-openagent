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

  test("#given live threads in two workspaces #when thread_list runs in the default scope #then only the caller's workspace is listed and all_scope widens it", async () => {
    // given: non-git directories, so workspace identity is realpath equality
    const workspaceA = mkdtempSync(join(tmpdir(), "thread-list-scope-a-"))
    const workspaceB = mkdtempSync(join(tmpdir(), "thread-list-scope-b-"))
    const inA = { sessionId: "route-a", durableSessionId: "dur-a", cwd: workspaceA, name: "alpha", status: "open" as const }
    const inB = { sessionId: "route-b", durableSessionId: "dur-b", cwd: workspaceB, name: "beta", status: "open" as const }
    const f = fixture()
    const host: ThreadHost = { ...f.host, listSessions: async () => [inA, inB] }
    const tools = createThreadTools({ host, stateDirectory: f.stateDirectory, callerSessionId: () => "route-a", callerWorkspaceRoot: () => workspaceA })
    const list = tools[1]
    const threadsOf = (result: Awaited<ReturnType<typeof list.execute>>) =>
      (result.details as { result: { threads: Array<{ thread_id: string }>; scope: string } }).result

    // when
    const scoped = threadsOf(await list.execute("call-1", {}, undefined, undefined, {} as never))
    const widened = threadsOf(await list.execute("call-2", { all_scope: true }, undefined, undefined, {} as never))

    // then
    expect({ scope: scoped.scope, ids: scoped.threads.map((thread) => thread.thread_id) }).toEqual({ scope: "workspace", ids: ["dur-a"] })
    expect({ scope: widened.scope, ids: widened.threads.map((thread) => thread.thread_id).sort() }).toEqual({ scope: "all", ids: ["dur-a", "dur-b"] })
  })

  test("unknown targets return the typed not_found result", async () => {
    const f = fixture()
    const list = createThreadTools({ ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    const result = await list[2].execute("call-1", { thread: "missing" }, undefined, undefined, {} as never)
    expect((result.details as { result: { kind: string; error?: { code: string } } }).result).toMatchObject({ kind: "error", error: { code: "not_found" } })
  })
})

import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createThreadTools, registerThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture() {
  const session = { sessionId: "route-peer", durableSessionId: "dur-peer", cwd: process.cwd(), name: "peer", status: "open" as const }
  const sessions: ThreadHostSession[] = [session]
  const models: Array<{ provider: string; id: string; name?: string }> = [
    { provider: "openai", id: "gpt-x", name: "GPT X" },
    { provider: "anthropic", id: "claude-test", name: "Claude Test" },
  ]
  const setSessionName = mock(async (sessionId: string, name: string) => {
    const index = sessions.findIndex((entry) => entry.sessionId === sessionId)
    sessions[index] = { ...sessions[index], name }
  })
  const setModel = mock(async (_sessionId: string, provider: string, modelId: string) => ({ provider, id: modelId, name: "Selected model" }))
  const getAvailableModels = mock(async (_sessionId: string) => models)
  const setThinkingLevel = mock(async (_sessionId: string, _level: string, _scope?: "session" | "turn") => {})
  const getAvailableThinkingLevels = mock(async (_sessionId: string) => ["off", "high"])
  const prompt = mock(async (_sessionId: string, _message: string) => ({ turnId: "turn-1" }))
  const host: ThreadHost = {
    socket: "/tmp/thread-tools-test.sock",
    listSessions: async () => sessions,
    openSession: async () => session,
    getMessages: async () => [{ role: "user", content: "hello" }],
    getState: async () => ({ isStreaming: false }),
    prompt,
    interrupt: async () => ({ interrupted: false }),
    setSessionName,
    setModel,
    getAvailableModels,
    setThinkingLevel,
    getAvailableThinkingLevels,
  }
  const stateDirectory = mkdtempSync(join(tmpdir(), "thread-tools-registration-"))
  directories.push(stateDirectory)
  return { host, stateDirectory, sessions, models, setSessionName, setModel, getAvailableModels, setThinkingLevel, getAvailableThinkingLevels, prompt }
}

function runner(f: ReturnType<typeof fixture>, callerSessionId = "unknown-caller", callerWorkspaceRoot = process.cwd()) {
  const tools = createThreadTools({ ...f, callerSessionId: () => callerSessionId, callerWorkspaceRoot: () => callerWorkspaceRoot })
  return async (name: ThreadToolName, args: unknown, callerId?: string, callId = "call-1"): Promise<ThreadToolResult> => {
    const tool = tools.find((candidate) => candidate.name === name)
    expect(tool, `${name} must be registered`).toBeDefined()
    const ectx = callerId === undefined ? undefined : { sessionManager: { getSessionId: () => callerId } }
    const result = await tool!.execute(callId, args, undefined, undefined, ectx as never)
    return result.details.result as ThreadToolResult
  }
}

describe("thread tool registration", () => {
  test("registers exactly the nine contract tools with search metadata", () => {
    const tools: Record<string, unknown>[] = []
    const f = fixture()
    registerThreadTools({ registerTool: (tool) => tools.push(tool) }, { ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    expect(tools.map((tool) => tool.name)).toEqual(["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff", "thread_rename", "thread_set_model", "thread_set_reasoning"])
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

describe("thread session controls", () => {
  test("rename trims the name and routes by the live id while returning the durable id", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "peer", name: "  New Name  " })).toEqual({ kind: "ok", thread_id: "dur-peer", name: "New Name" })
    expect(f.setSessionName.mock.calls).toEqual([["route-peer", "New Name"]])
  })

  test("rename rejects another visible thread's trimmed case-insensitive name", async () => {
    const f = fixture()
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: process.cwd(), name: "  Taken  " })
    expect(await runner(f)("thread_rename", { thread: "peer", name: " TAKEN " })).toMatchObject({ kind: "error", error: { code: "name_conflict", next_action: expect.any(String) } })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test("rename allows keeping its own name", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "peer", name: "PEER" })).toEqual({ kind: "ok", thread_id: "dur-peer", name: "PEER" })
  })

  test("rename rejects whitespace-only names without a host mutation", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "peer", name: "   " })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test("rename conflict checks only visible threads unless all_scope widens visibility", async () => {
    const f = fixture()
    const otherWorkspace = mkdtempSync(join(tmpdir(), "thread-rename-scope-"))
    directories.push(otherWorkspace)
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: otherWorkspace, name: "Taken" })
    const run = runner(f)
    expect(await run("thread_rename", { thread: "dur-peer", name: "Taken" })).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Taken" })
    expect(await run("thread_rename", { thread: "dur-peer", name: "Taken", all_scope: true }, undefined, "call-2")).toMatchObject({ kind: "error", error: { code: "name_conflict" } })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test.each(["GPT-X", "gPt X"])("set_model resolves a unique id or display-name pattern %s", async (model) => {
    const f = fixture()
    expect(await runner(f)("thread_set_model", { thread: "peer", model })).toEqual({ kind: "ok", thread_id: "dur-peer", model: { provider: "openai", id: "gpt-x" } })
    expect(f.getAvailableModels.mock.calls).toEqual([["route-peer"]])
    expect(f.setModel.mock.calls).toEqual([["route-peer", "openai", "gpt-x"]])
  })

  test("set_model reports no match with at most twenty available provider/id values", async () => {
    const f = fixture()
    f.models.splice(0, f.models.length, ...Array.from({ length: 25 }, (_, index) => ({ provider: "test", id: `model-${index}` })))
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "missing" })).toMatchObject({ kind: "error", error: { code: "model_not_found", details: { available: f.models.slice(0, 20).map((model) => `${model.provider}/${model.id}`) } } })
    expect(f.setModel).not.toHaveBeenCalled()
  })

  test("set_model reports two matches as ambiguous rather than choosing the first", async () => {
    const f = fixture()
    f.models.push({ provider: "other", id: "gpt-y" })
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "gpt" })).toMatchObject({ kind: "error", error: { code: "model_ambiguous", details: { candidates: ["openai/gpt-x", "other/gpt-y"] } } })
    expect(f.setModel).not.toHaveBeenCalled()
  })

  test("set_model ambiguity details contain at most ten candidates", async () => {
    const f = fixture()
    f.models.splice(0, f.models.length, ...Array.from({ length: 15 }, (_, index) => ({ provider: "test", id: `model-${index}` })))
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "model" })).toMatchObject({ kind: "error", error: { code: "model_ambiguous", details: { candidates: f.models.slice(0, 10).map((model) => `${model.provider}/${model.id}`) } } })
    expect(f.setModel).not.toHaveBeenCalled()
  })

  test.each(["openai/gpt-x", "gpt-x"])("set_model gives exact reference %s priority over fragments", async (model) => {
    const f = fixture()
    f.models.push({ provider: "openai", id: "gpt-x-mini" })
    expect(await runner(f)("thread_set_model", { thread: "peer", model })).toEqual({ kind: "ok", thread_id: "dur-peer", model: { provider: "openai", id: "gpt-x" } })
    expect(f.setModel.mock.calls).toEqual([["route-peer", "openai", "gpt-x"]])
  })

  test("set_model provider narrows a fragment shared across providers", async () => {
    const f = fixture()
    f.models.push({ provider: "other", id: "gpt-y" })
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "gpt", provider: "other" })).toEqual({ kind: "ok", thread_id: "dur-peer", model: { provider: "other", id: "gpt-y" } })
    expect(f.setModel.mock.calls).toEqual([["route-peer", "other", "gpt-y"]])
  })

  test("set_model refuses a cross-workspace id until all_scope is supplied", async () => {
    const f = fixture()
    const otherWorkspace = mkdtempSync(join(tmpdir(), "thread-model-scope-"))
    directories.push(otherWorkspace)
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: otherWorkspace, name: "other" })
    const run = runner(f)
    expect(await run("thread_set_model", { thread: "dur-other", model: "gpt-x" })).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(f.getAvailableModels).not.toHaveBeenCalled()
    expect(f.setModel).not.toHaveBeenCalled()
    expect(await run("thread_set_model", { thread: "dur-other", model: "gpt-x", all_scope: true }, undefined, "call-2")).toMatchObject({ kind: "ok", thread_id: "dur-other" })
    expect(f.setModel.mock.calls).toEqual([["route-other", "openai", "gpt-x"]])
  })

  test.each([undefined, "session", "turn"] as const)("set_reasoning passes and echoes scope %s", async (scope) => {
    const f = fixture()
    expect(await runner(f)("thread_set_reasoning", { thread: "peer", level: "high", ...(scope === undefined ? {} : { scope }) })).toEqual({ kind: "ok", thread_id: "dur-peer", level: "high", scope: scope ?? "session" })
    expect(f.setThinkingLevel.mock.calls).toEqual([["route-peer", "high", scope === "turn" ? "turn" : undefined]])
    expect(f.getAvailableThinkingLevels).not.toHaveBeenCalled()
  })

  test("set_reasoning classifies unsupported levels with the host's supported list and replays the rejection", async () => {
    const f = fixture()
    f.setThinkingLevel.mockImplementation(async () => { throw new Error("thinking_level_unsupported:Thinking level low is not supported by the active model.") })
    const run = runner(f)
    const args = { thread: "peer", level: "low", idempotency_key: "reject-low" }
    const result = await run("thread_set_reasoning", args)
    expect(result).toMatchObject({ kind: "error", error: { code: "thinking_level_unsupported", details: { supported: ["off", "high"] }, next_action: expect.any(String) } })
    expect(await run("thread_set_reasoning", args, undefined, "call-2")).toEqual(result)
    expect(f.setThinkingLevel).toHaveBeenCalledTimes(1)
    expect(f.getAvailableThinkingLevels.mock.calls).toEqual([["route-peer"]])
  })

  test("unclassified reasoning failures remain internal_error data", async () => {
    const f = fixture()
    f.setThinkingLevel.mockImplementation(async () => { throw new Error("connection lost") })
    expect(await runner(f)("thread_set_reasoning", { thread: "peer", level: "high" })).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(f.getAvailableThinkingLevels).not.toHaveBeenCalled()
  })

  test.each([
    { name: "thread_rename", args: { thread: "self", name: "New Name" } },
    { name: "thread_set_model", args: { thread: "self", model: "gpt-x" } },
    { name: "thread_set_reasoning", args: { thread: "self", level: "high" } },
    { name: "thread_read", args: { thread: "self" } },
    { name: "thread_send", args: { thread: "self", message: "hello" } },
    { name: "thread_interrupt", args: { thread: "self" } },
    { name: "thread_handoff", args: { thread: "self", message: "hello" } },
  ] as const)("$name resolves self from the fifth-argument caller durable id", async ({ name, args }) => {
    const f = fixture()
    const result = await runner(f)(name, args, "dur-peer")
    expect(result).toMatchObject(name === "thread_handoff" ? { kind: "ok", thread: { thread_id: "dur-peer" } } : { kind: "ok", thread_id: "dur-peer" })
    if (name === "thread_rename") expect(f.setSessionName.mock.calls).toEqual([["route-peer", "New Name"]])
  })

  test("self without a known caller fails closed instead of matching a thread named self", async () => {
    const f = fixture()
    f.sessions[0] = { ...f.sessions[0], name: "self" }
    expect(await runner(f)("thread_rename", { thread: "self", name: "New Name" })).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test("self uses the callerSessionId fallback when no execution context is supplied", async () => {
    const f = fixture()
    expect(await runner(f, "dur-peer")("thread_rename", { thread: "self", name: "New Name" })).toEqual({ kind: "ok", thread_id: "dur-peer", name: "New Name" })
  })

  test("the unknown-caller placeholder is an absent identity, not an addressable id", async () => {
    // A placeholder that matches a real entry would let "self" act on a thread the caller does
    // not own, so the sentinel must fail closed even when some thread carries it as its id.
    const f = fixture()
    f.sessions[0] = { ...f.sessions[0], durableSessionId: "unknown-caller" }
    expect(await runner(f)("thread_rename", { thread: "self", name: "hijacked" })).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test.each([
    { name: "thread_rename", args: { thread: "dur-peer", name: "New Name", idempotency_key: "shared-key" }, calls: "setSessionName" },
    { name: "thread_set_model", args: { thread: "dur-peer", model: "gpt-x", idempotency_key: "shared-key" }, calls: "setModel" },
    { name: "thread_set_reasoning", args: { thread: "dur-peer", level: "high", idempotency_key: "shared-key" }, calls: "setThinkingLevel" },
  ] as const)("$name receipts replay for one caller but remain isolated between execution contexts", async ({ name, args, calls }) => {
    const f = fixture()
    const run = runner(f)
    const first = await run(name, args, "caller-a", "call-1")
    expect(first.kind).toBe("ok")
    expect(await run(name, args, "caller-a", "call-2")).toMatchObject(first)
    expect(f[calls]).toHaveBeenCalledTimes(1)
    expect((await run(name, args, "caller-b", "call-1")).kind).toBe("ok")
    expect(f[calls]).toHaveBeenCalledTimes(2)
  })

  test("fuzzy handoff excludes the caller even when its own name is the strongest match", async () => {
    const f = fixture()
    f.sessions[0] = { ...f.sessions[0], name: "payments worker" }
    f.sessions.push({ sessionId: "route-self", durableSessionId: "dur-self", cwd: process.cwd(), name: "payments work" })
    expect(await runner(f)("thread_handoff", { thread: "payments work", match: "fuzzy", message: "continue" }, "dur-self")).toMatchObject({ kind: "ok", thread: { thread_id: "dur-peer" }, resolved_by: "fuzzy" })
    expect(f.prompt.mock.calls[0]?.[0]).toBe("route-peer")
  })

  test("fuzzy handoff cannot select the caller when it is the only candidate", async () => {
    const f = fixture()
    expect(await runner(f)("thread_handoff", { thread: "peer", match: "fuzzy", message: "continue" }, "dur-peer")).toMatchObject({ kind: "error", error: { code: "not_found" } })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  test("thread_list returns host failures as data rather than rejecting", async () => {
    const f = fixture()
    f.host = { ...f.host, listSessions: async () => { throw new Error("host_unavailable:/missing.sock") } }
    expect(await runner(f)("thread_list", {})).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
  })
})

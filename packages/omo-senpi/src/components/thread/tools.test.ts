import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import type { GatewayEndpointRef } from "./gateway/adapter"
import { GATEWAY_RECEIPT_RETENTION_MS } from "./gateway/constants"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadTools, RECEIPT_RECOVERY_MAX_KEYS, registerThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempStore(): GatewayStore {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-tools-gateway-"))
  directories.push(agentDir)
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  return store
}

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
  return { host, stateDirectory, store: tempStore(), sessions, models, setSessionName, setModel, getAvailableModels, setThinkingLevel, getAvailableThinkingLevels, prompt }
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
  test("registers exactly the seventeen contract tools with search metadata", () => {
    const tools: Record<string, unknown>[] = []
    const f = fixture()
    registerThreadTools({ registerTool: (tool) => tools.push(tool) }, { ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    expect(tools.map((tool) => tool.name)).toEqual([
      "thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff", "thread_rename", "thread_set_model", "thread_set_reasoning",
      "thread_bind", "thread_unbind", "thread_rebind", "thread_bindings", "thread_report", "thread_outbox", "thread_outbox_ack", "thread_answer",
    ])
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
    const tools = createThreadTools({ host, stateDirectory: f.stateDirectory, store: f.store, callerSessionId: () => "route-a", callerWorkspaceRoot: () => workspaceA })
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
    { name: "thread_interrupt", args: { thread: "self" } },
  ] as const)("$name resolves self from the fifth-argument caller durable id", async ({ name, args }) => {
    const f = fixture()
    const result = await runner(f)(name, args, "dur-peer")
    expect(result).toMatchObject({ kind: "ok", thread_id: "dur-peer" })
    if (name === "thread_rename") expect(f.setSessionName.mock.calls).toEqual([["route-peer", "New Name"]])
  })

  test.each([
    { name: "thread_send", args: { thread: "self", message: "hello" } },
    { name: "thread_handoff", args: { thread: "self", message: "hello" } },
  ] as const)("$name to self resolves the caller, and the gateway refuses a session delivering to itself", async ({ name, args }) => {
    const f = fixture()
    expect(await runner(f)(name, args, "dur-peer")).toMatchObject({ kind: "error", error: { code: "loop_detected", details: { guard: "self_send" } } })
    expect(f.prompt).not.toHaveBeenCalled()
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
    expect(f.prompt).not.toHaveBeenCalled()
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

const TUI_SOCKET = "/tmp/t-0123456789abcdef.sock"
const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"

/** A host session (the caller) and a terminal session, each on its own endpoint, with a recording gateway port. */
function gatewayFixture() {
  const f = fixture()
  const hostSession: ThreadHostSession = { sessionId: "rpc-1", durableSessionId: "dur-host", cwd: process.cwd(), name: "host lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
  const tuiSession: ThreadHostSession = { sessionId: "dur-tui", durableSessionId: "dur-tui", cwd: process.cwd(), name: "my-tui", status: "open", socket: TUI_SOCKET, endpoint_kind: "tui" }
  const wakes: { endpoint: GatewayEndpointRef; ids: readonly string[] }[] = []
  const host: ThreadHost = {
    ...f.host,
    listView: async () => ({
      sessions: [hostSession, tuiSession],
      hosts: [
        { socket: HOST_SOCKET, list_sessions: { sessions: [hostSession] }, endpoint_kind: "rpc_host", alive: true },
        { socket: TUI_SOCKET, list_sessions: { sessions: [tuiSession] }, endpoint_kind: "tui", alive: true },
      ],
      disk: [],
    }),
    gateway: {
      wake: async (endpoint, ids) => {
        wakes.push({ endpoint, ids })
        return { admitted: [] }
      },
    },
  }
  const run = async (name: ThreadToolName, args: unknown, callerId: string, callId: string): Promise<ThreadToolResult> => {
    const tools = createThreadTools({ host, stateDirectory: f.stateDirectory, store: f.store, callerSessionId: () => callerId, callerWorkspaceRoot: () => process.cwd() })
    const tool = tools.find((candidate) => candidate.name === name)
    const result = await tool!.execute(callId, args, undefined, undefined, { sessionManager: { getSessionId: () => callerId } } as never)
    return result.details.result as ThreadToolResult
  }
  return { f, wakes, run }
}

describe("thread_send through the session gateway", () => {
  test("#given a host session and a terminal endpoint #when the host session sends to the terminal #then the result carries delivery_id and endpoint.kind tui and only a wake reached the terminal", async () => {
    const g = gatewayFixture()
    const result = await g.run("thread_send", { thread: "my-tui", message: "hello terminal" }, "dur-host", "call-1")
    expect(result).toMatchObject({ kind: "ok", thread_id: "dur-tui", endpoint: { kind: "tui" }, effective_mode: "auto", delivery: { kind: "queued" }, deduplicated: false })
    const deliveryId = (result as { delivery_id?: string }).delivery_id
    expect(typeof deliveryId).toBe("string")
    expect(g.wakes).toEqual([{ endpoint: { kind: "tui", socket: TUI_SOCKET, routing_id: "dur-tui" }, ids: [deliveryId as string] }])
    expect(g.f.prompt).not.toHaveBeenCalled()
    const rows = await g.f.store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => ({ id: row.delivery_id, state: row.state, sender: row.sender }))).toEqual([{ id: deliveryId as string, state: "queued", sender: "session:dur-host" }])
  })

  test("#given a gateway send #when the caller retries it with the same idempotency key #then the same delivery is replayed and nothing is sent twice", async () => {
    const g = gatewayFixture()
    const args = { thread: "dur-tui", message: "once", idempotency_key: "k-1" }
    const first = await g.run("thread_send", args, "dur-host", "call-1")
    const second = await g.run("thread_send", args, "dur-host", "call-2")
    expect((second as { delivery_id?: string }).delivery_id).toBe((first as { delivery_id?: string }).delivery_id)
    expect(second).toMatchObject({ kind: "ok", deduplicated: true })
    expect(await g.f.store.list({ target_durable_id: "dur-tui" })).toHaveLength(1)
    expect(g.wakes).toHaveLength(1)
  })

  test("#given the gateway send path #when a session sends to itself #then it is refused loop_detected before any row is written", async () => {
    const g = gatewayFixture()
    expect(await g.run("thread_send", { thread: "self", message: "echo" }, "dur-tui", "call-1")).toMatchObject({ kind: "error", error: { code: "loop_detected" } })
    expect(await g.f.store.list({ target_durable_id: "dur-tui" })).toEqual([])
  })
})

describe("relay tools over the gateway store", () => {
  test("#given session A binds a chat thread for session B #when B reports a milestone #then a connector reads it with the binding revision and a cursor, acks it, and a second bind of the thread is binding_conflict", async () => {
    const g = gatewayFixture()
    const bound = await g.run("thread_bind", { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", session: "my-tui" }, "dur-host", "call-1")
    expect(bound).toMatchObject({ kind: "ok", binding: { status: "active", revision: 1, session_durable_id: "dur-tui", thread_id: "t1", ttl_seconds: 604800 } })
    const bindingId = (bound as { binding: { binding_id: string } }).binding.binding_id
    const reported = await g.run("thread_report", { binding_id: bindingId, kind: "milestone", text: "done step 1" }, "dur-tui", "call-2")
    expect(reported).toMatchObject({ kind: "ok", binding_id: bindingId, revision: 1, event: "milestone" })
    const read = await g.run("thread_outbox", { binding_id: bindingId }, "connector", "call-3")
    expect(read).toMatchObject({ kind: "ok", rows: [{ event: "milestone", text: "done step 1", revision: 1, cursor: (reported as { cursor: number }).cursor }] })
    expect(await g.run("thread_outbox_ack", { binding_id: bindingId, cursor: (reported as { cursor: number }).cursor }, "connector", "call-4")).toMatchObject({ kind: "ok", changed: true })
    expect(await g.run("thread_outbox", { binding_id: bindingId }, "connector", "call-5")).toMatchObject({ kind: "ok", rows: [] })
    expect(await g.run("thread_bind", { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", session: "dur-host" }, "dur-host", "call-6")).toMatchObject({ kind: "error", error: { code: "binding_conflict", details: { binding_id: bindingId } } })
  })

  test("#given a binding of session B #when another session reports through it #then it is scope_denied and the outbox stays empty", async () => {
    const g = gatewayFixture()
    const bound = await g.run("thread_bind", { platform: "discord", account_id: "bot", chat_id: "c9", session: "my-tui" }, "dur-host", "call-1")
    const bindingId = (bound as { binding: { binding_id: string } }).binding.binding_id
    expect(await g.run("thread_report", { binding_id: bindingId, kind: "report", text: "not mine" }, "dur-host", "call-2")).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(await g.run("thread_outbox", { binding_id: bindingId }, "connector", "call-3")).toMatchObject({ kind: "ok", rows: [] })
  })
})

describe("tool receipts the store could not settle", () => {
  test("#given a side effect that ran while the store gave up recording its receipt #when the same key is retried #then the first call still returns its result and the retry is idempotency_uncertain, never in_progress and never a second side effect", async () => {
    const f = fixture()
    const real = f.store
    let failSettle = true
    const store: GatewayStore = {
      ...real,
      toolReceiptSettle: async (request) => {
        if (!failSettle) return await real.toolReceiptSettle(request)
        failSettle = false
        throw Object.assign(new Error("gateway store lock wait exceeded: tool_receipt_settle waited 25000 ms for the write lock (limit 30000 ms); another process holds it"), { code: "gateway_lock_wait_exceeded" })
      },
    }
    const run = runner({ ...f, store }, "caller")
    expect(await run("thread_rename", { thread: "peer", name: "Renamed", idempotency_key: "rename-1" }, "caller")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    const retried = await run("thread_rename", { thread: "peer", name: "Renamed", idempotency_key: "rename-1" }, "caller")
    expect(retried).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain", details: { error_note: expect.stringContaining("could not be recorded") } } })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given the store fails while admitting a receipted call's receipt #when the tool runs #then it answers overloaded for a lock-wait and internal_error otherwise, as data, runs nothing, and a later call runs once", async () => {
    const f = fixture()
    const real = f.store
    const failures: Error[] = [
      Object.assign(new Error("gateway store lock wait exceeded: tool_receipt_begin waited 25000 ms for the write lock (limit 30000 ms); another process holds it"), { code: "gateway_lock_wait_exceeded" }),
      new Error("the gateway store worker exited"),
    ]
    const store: GatewayStore = {
      ...real,
      toolReceiptBegin: async (request) => {
        const failure = failures.shift()
        if (failure !== undefined) throw failure
        return await real.toolReceiptBegin(request)
      },
    }
    const run = runner({ ...f, store }, "caller")
    const args = { thread: "peer", name: "Renamed", idempotency_key: "rename-begin" }
    expect(await run("thread_rename", args, "caller")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    expect(await run("thread_rename", args, "caller")).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(await run("thread_rename", args, "caller")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given the store committed a call's receipt but its reply was lost #when the same key is retried #then the retry runs the call once and later retries replay its result", async () => {
    const f = fixture()
    const real = f.store
    let dropReply = true
    const store: GatewayStore = {
      ...real,
      toolReceiptBegin: async (request) => {
        const admission = await real.toolReceiptBegin(request)
        if (!dropReply) return admission
        // The worker committed the prepared receipt, then exited before its reply reached the caller.
        dropReply = false
        throw new Error("the gateway store worker exited (1)")
      },
    }
    const run = runner({ ...f, store }, "caller")
    const args = { thread: "peer", name: "Renamed", idempotency_key: "rename-lost-reply" }
    expect(await run("thread_rename", args, "caller")).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(await run("thread_rename", args, "caller")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(await run("thread_rename", args, "caller")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  /** A registered surface over a store whose receipt admission can fail before writing (`fail`) or after committing (`lost-reply`). */
  function recoverySurface(f: ReturnType<typeof fixture>, clock: { now: number }) {
    const real = f.store
    const admissions = { mode: "real" as "real" | "fail" | "lost-reply" }
    const store: GatewayStore = {
      ...real,
      toolReceiptBegin: async (request) => {
        if (admissions.mode === "fail") throw new Error("the gateway store worker exited (1)")
        const admission = await real.toolReceiptBegin(request)
        if (admissions.mode === "lost-reply") throw new Error("the gateway store worker exited (1)")
        return admission
      },
    }
    const tools: Record<string, unknown>[] = []
    const surface = registerThreadTools({ registerTool: (tool) => tools.push(tool) }, { ...f, store, now: () => clock.now, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    const rename = async (key: string): Promise<ThreadToolResult> => {
      const tool = tools.find((candidate) => candidate.name === "thread_rename") as { execute: (...args: unknown[]) => Promise<{ details: { result: ThreadToolResult } }> }
      return (await tool.execute(`call-${key}`, { thread: "dur-peer", name: "Renamed", idempotency_key: key }, undefined, undefined, { sessionManager: { getSessionId: () => "caller" } })).details.result
    }
    /** `count` calls whose admissions fail without a reply and without a receipt. */
    const failMany = async (prefix: string, count: number) => {
      admissions.mode = "fail"
      for (let index = 0; index < count; index++) expect(await rename(`${prefix}-${index}`)).toMatchObject({ kind: "error", error: { code: "internal_error" } })
      admissions.mode = "real"
    }
    return { admissions, rename, failMany, dispose: surface.dispose }
  }

  test("#given as many keys as the recovery bound whose admissions failed without a reply #when a call under a new key arrives #then it is refused overloaded and runs nothing, the oldest key still recovers, and a new key runs once that frees a slot", async () => {
    const f = fixture()
    const s = recoverySurface(f, { now: Date.now() })
    s.admissions.mode = "lost-reply"
    expect(await s.rename("lost-oldest")).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS - 1)

    expect(await s.rename("new")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(await s.rename("lost-oldest")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(await s.rename("new")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(2)
  })

  test("#given the recovery bound filled by failed admissions #when the receipt retention passes #then those keys stop holding slots and a call under a new key runs", async () => {
    const f = fixture()
    const clock = { now: Date.now() }
    const s = recoverySurface(f, clock)
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS)
    clock.now += GATEWAY_RECEIPT_RETENTION_MS - 1
    expect(await s.rename("before-expiry")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    clock.now += 1
    expect(await s.rename("at-expiry")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given the recovery bound filled by failed admissions #when the tool surface is disposed #then its recovery keys are released and a call under a new key runs", async () => {
    const f = fixture()
    const s = recoverySurface(f, { now: Date.now() })
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS)
    expect(await s.rename("before-dispose")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    s.dispose()
    expect(await s.rename("after-dispose")).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given a call still running under a key #when a second invocation of the key loses its receipt reply and a third retries #then the retry is idempotency_in_progress and the side effect runs once", async () => {
    const f = fixture()
    const real = f.store
    let begins = 0
    let releaseRename: () => void = () => undefined
    const renameHeld = new Promise<void>((resolve) => { releaseRename = resolve })
    let renameStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { renameStarted = resolve })
    f.setSessionName.mockImplementation(async (sessionId: string, name: string) => {
      renameStarted()
      await renameHeld
      const index = f.sessions.findIndex((entry) => entry.sessionId === sessionId)
      f.sessions[index] = { ...f.sessions[index], name }
    })
    const store: GatewayStore = {
      ...real,
      toolReceiptBegin: async (request) => {
        const admission = await real.toolReceiptBegin(request)
        // The second invocation's admission (in_progress, nothing written) never reaches it.
        if (++begins === 2) throw new Error("the gateway store worker exited (1)")
        return admission
      },
    }
    const run = runner({ ...f, store }, "caller")
    const args = { thread: "peer", name: "Renamed", idempotency_key: "rename-lost-concurrent" }
    const first = run("thread_rename", args, "caller")
    await started
    expect(await run("thread_rename", args, "caller")).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(await run("thread_rename", args, "caller")).toMatchObject({ kind: "error", error: { code: "idempotency_in_progress" } })
    releaseRename()
    expect(await first).toEqual({ kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })
})

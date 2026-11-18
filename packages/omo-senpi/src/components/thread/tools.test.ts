import { Database } from "bun:sqlite"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { deliverySender } from "./gateway/provenance"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseThreadParams, threadToolParamSchemas, type ThreadToolName, type ThreadToolResult } from "./contracts"
import type { GatewayEndpointRef } from "./gateway/adapter"
import { type BindInput, hashArgs, normalizeBindInput } from "./gateway/bindings"
import { GATEWAY_RECEIPT_RETENTION_MS } from "./gateway/constants"
import { gatewayDatabasePath } from "./gateway/paths"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { storeMigratedByNewerBuild } from "./gateway/testing/newer-schema"
import type { ThreadToolFailure } from "./errors"
import { parseThreadLinkUrl } from "./thread-link"
import {
  createThreadTools,
  RECEIPT_RECOVERY_MAX_KEYS,
  registerThreadTools,
  type ThreadHost,
  type ThreadHostSession,
} from "./tools"

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
  const session = {
    sessionId: "route-peer",
    durableSessionId: "dur-peer",
    cwd: process.cwd(),
    name: "peer",
    status: "open" as const,
  }
  const sessions: ThreadHostSession[] = [session]
  const models: Array<{ provider: string; id: string; name?: string }> = [
    { provider: "openai", id: "gpt-x", name: "GPT X" },
    { provider: "anthropic", id: "claude-test", name: "Claude Test" },
  ]
  const setSessionName = mock(async (sessionId: string, name: string, _durableId?: string) => {
    const index = sessions.findIndex((entry) => entry.sessionId === sessionId)
    sessions[index] = { ...sessions[index], name }
  })
  const setModel = mock(async (_sessionId: string, provider: string, modelId: string, _durableId?: string) => ({
    provider,
    id: modelId,
    name: "Selected model",
  }))
  const getAvailableModels = mock(async (_sessionId: string) => models)
  const setThinkingLevel = mock(
    async (_sessionId: string, _level: string, _scope?: "session" | "turn", _durableId?: string) => {},
  )
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
  return {
    host,
    stateDirectory,
    store: tempStore(),
    sessions,
    models,
    setSessionName,
    setModel,
    getAvailableModels,
    setThinkingLevel,
    getAvailableThinkingLevels,
    prompt,
  }
}

function runner(
  f: ReturnType<typeof fixture>,
  callerSessionId = "unknown-caller",
  callerWorkspaceRoot = process.cwd(),
) {
  const tools = createThreadTools({
    ...f,
    callerSessionId: () => callerSessionId,
    callerWorkspaceRoot: () => callerWorkspaceRoot,
  })
  return async (
    name: ThreadToolName,
    args: unknown,
    callerId?: string,
    callId = "call-1",
  ): Promise<ThreadToolResult> => {
    const tool = tools.find((candidate) => candidate.name === name)
    expect(tool, `${name} must be registered`).toBeDefined()
    const ectx = callerId === undefined ? undefined : { sessionManager: { getSessionId: () => callerId } }
    const result = await tool!.execute(callId, args, undefined, undefined, ectx as never)
    return result.details.result as ThreadToolResult
  }
}

describe("thread tool registration", () => {
  test("#given a selected session #when model discovery observes a replacement #then the mutation retains the selected durable id", async () => {
    const f = fixture()
    f.getAvailableModels.mockImplementation(async () => {
      f.sessions[0] = { ...f.sessions[0], durableSessionId: "replacement" }
      return f.models
    })
    expect(await runner(f)("thread_set_model", { thread: "dur-peer", model: "openai/gpt-x" })).toMatchObject({
      kind: "ok",
    })
    expect(f.setModel.mock.calls[0]).toEqual(["route-peer", "openai", "gpt-x", "dur-peer"])
  })

  test("registers exactly the fifteen contract tools with eval exposure", () => {
    const tools: Record<string, unknown>[] = []
    const f = fixture()
    registerThreadTools(
      { registerTool: (tool) => tools.push(tool) },
      { ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() },
    )
    expect(tools.map((tool) => tool.name)).toEqual([
      "thread_create",
      "thread_list",
      "thread_read",
      "thread_send",
      "thread_interrupt",
      "thread_close",
      "thread_handoff",
      "thread_rename",
      "thread_set_model",
      "thread_set_reasoning",
      "thread_archive",
      "thread_report",
      "thread_outbox",
      "thread_outbox_ack",
      "thread_answer",
    ])
    for (const tool of tools) {
      expect(tool.exposure, String(tool.name)).toBe("eval")
      expect(
        ["searchGroup", "searchText", "searchKeywords"].filter((key) => key in tool),
        String(tool.name),
      ).toEqual([])
    }
  })

  test("#given the registered tools #when one runs #then the model still gets the JSON result while the TUI row renders a summary (#12994)", async () => {
    const tools: Array<Record<string, unknown> & ReturnType<typeof createThreadTools>[number]> = []
    const f = fixture()
    registerThreadTools(
      { registerTool: (tool) => tools.push(tool as never) },
      { ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() },
    )
    expect(
      tools
        .filter((tool) => typeof tool.renderCall !== "function" || typeof tool.renderResult !== "function")
        .map((tool) => tool.name),
    ).toEqual([])

    const list = tools.find((tool) => tool.name === "thread_list")
    expect(typeof list?.renderResult).toBe("function")
    if (list?.renderResult === undefined) return
    const output = await list.execute("call-1", {}, undefined, undefined, {} as never)
    // The model-facing content is the result JSON, byte for byte: rendering changes only what the person sees.
    expect(output.content).toEqual([{ type: "text", text: JSON.stringify(output.details.result) }])
    const plain = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never
    const lines = list
      .renderResult(output, { expanded: false, isPartial: false }, plain, { args: {}, isError: false } as never)
      .render(200)
    expect(lines[0]?.trimEnd()).toBe("1 thread in this workspace")
  })

  test("#given live threads in two workspaces #when thread_list runs in the default scope #then only the caller's workspace is listed and all_scope widens it", async () => {
    // given: non-git directories, so workspace identity is realpath equality
    const workspaceA = mkdtempSync(join(tmpdir(), "thread-list-scope-a-"))
    const workspaceB = mkdtempSync(join(tmpdir(), "thread-list-scope-b-"))
    const inA = {
      sessionId: "route-a",
      durableSessionId: "dur-a",
      cwd: workspaceA,
      name: "alpha",
      status: "open" as const,
    }
    const inB = {
      sessionId: "route-b",
      durableSessionId: "dur-b",
      cwd: workspaceB,
      name: "beta",
      status: "open" as const,
    }
    const f = fixture()
    const host: ThreadHost = { ...f.host, listSessions: async () => [inA, inB] }
    const tools = createThreadTools({
      host,
      stateDirectory: f.stateDirectory,
      store: f.store,
      callerSessionId: () => "route-a",
      callerWorkspaceRoot: () => workspaceA,
    })
    const list = tools[1]
    const threadsOf = (result: Awaited<ReturnType<typeof list.execute>>) =>
      (result.details as { result: { threads: Array<{ thread: string }>; scope: string } }).result

    // when
    const scoped = threadsOf(await list.execute("call-1", {}, undefined, undefined, {} as never))
    const widened = threadsOf(await list.execute("call-2", { all_scope: true }, undefined, undefined, {} as never))

    // then
    expect({ scope: scoped.scope, ids: scoped.threads.map((thread) => thread.thread) }).toEqual({
      scope: "workspace",
      ids: ["dur-a"],
    })
    expect({ scope: widened.scope, ids: widened.threads.map((thread) => thread.thread).sort() }).toEqual({
      scope: "all",
      ids: ["dur-a", "dur-b"],
    })
  })

  test("unknown targets return the typed not_found result", async () => {
    const f = fixture()
    const list = createThreadTools({ ...f, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() })
    const result = await list[2].execute("call-1", { thread: "missing" }, undefined, undefined, {} as never)
    expect((result.details as { result: { kind: string; error?: { code: string } } }).result).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
  })

  test("#given a live transcript longer than one byte window #when thread_read follows next_cursor #then the first read ends at the newest message and each next one returns the slice before it until the start", async () => {
    // given
    const f = fixture()
    const transcript = Array.from({ length: 12 }, (_, index) => ({
      role: "assistant",
      content: `m${index}:${"x".repeat(200)}`,
    }))
    const run = runner({ ...f, host: { ...f.host, getMessages: async () => transcript } })

    // when
    const pages: Array<{ contents: string[]; next_cursor?: string }> = []
    let cursor: string | undefined
    do {
      const page = (await run(
        "thread_read",
        { thread: "dur-peer", max_bytes: 1000, ...(cursor === undefined ? {} : { cursor }) },
        undefined,
        `read-${pages.length}`,
      )) as Extract<ThreadToolResult, { kind: "ok"; items: unknown }>
      expect(page).toMatchObject({ kind: "ok" })
      cursor = (page as { next_cursor?: string }).next_cursor
      pages.push({
        contents: (page.items as ReadonlyArray<{ content: string }>).map((item) => item.content),
        ...(cursor === undefined ? {} : { next_cursor: cursor }),
      })
    } while (cursor !== undefined && pages.length < 20)

    // then
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0]?.contents.at(-1)).toBe(JSON.stringify(transcript.at(-1)?.content))
    expect(pages.reverse().flatMap((page) => page.contents)).toEqual(
      transcript.map((message) => JSON.stringify(message.content)),
    )
  })
})

describe("thread links", () => {
  const linkTarget = (link: unknown) => {
    const match = /^\[[^\]]+\]\((omo-thread:\/\/v1\/[^)]+)\)$/.exec(String(link))
    return match === null ? null : parseThreadLinkUrl(match[1])
  }

  test("#given thread tools that name a thread #when they succeed #then each result carries a link that names that thread", async () => {
    // given
    const f = fixture()
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: process.cwd(), name: "other" })
    const run = runner(f)

    // when
    const listed = (await run("thread_list", {}, undefined, "call-list")) as unknown as {
      threads: Array<{ thread: string; link?: string }>
    }
    const created = (await run("thread_create", { name: "fresh" }, undefined, "call-create")) as unknown as {
      thread: string
      link?: string
    }
    const read = (await run("thread_read", { thread: "peer" }, undefined, "call-read")) as unknown as {
      thread: string
      link?: string
    }
    const sent = (await run("thread_send", { thread: "peer", message: "hi" }, "dur-other", "call-send")) as unknown as {
      thread: string
      link?: string
    }
    const handed = (await run(
      "thread_handoff",
      { thread: "peer", message: "go" },
      "dur-other",
      "call-handoff",
    )) as unknown as { thread: string; link?: string }

    // then
    expect(listed.threads.length).toBeGreaterThan(0)
    for (const thread of listed.threads) expect(linkTarget(thread.link)).toEqual({ threadId: thread.thread })
    expect(linkTarget(created.link)).toEqual({ threadId: created.thread })
    expect(linkTarget(read.link)).toEqual({ threadId: "dur-peer" })
    expect(linkTarget(sent.link)).toEqual({ threadId: "dur-peer" })
    expect(linkTarget(handed.link)).toEqual({ threadId: "dur-peer" })
    expect(String(read.link)).toStartWith("[peer]")
  })
})

describe("thread session controls", () => {
  test("rename trims the name and routes by the live id while returning the durable id", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "peer", name: "  New Name  " })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      name: "New Name",
    })
    expect(f.setSessionName.mock.calls).toEqual([["route-peer", "New Name", "dur-peer"]])
  })

  test("rename rejects another visible thread's trimmed case-insensitive name", async () => {
    const f = fixture()
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: process.cwd(), name: "  Taken  " })
    expect(await runner(f)("thread_rename", { thread: "peer", name: " TAKEN " })).toMatchObject({
      kind: "error",
      error: { code: "name_conflict", next_action: expect.any(String) },
    })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test.each([
    ["alpha", "\uff41\uff4c\uff50\uff48\uff41"],
    ["alpha beta", "alpha  beta"],
  ])(
    "#given a thread named %p #when another is created or renamed to %p #then both are name_conflict, as addressing would treat the names as equal",
    async (existing, requested) => {
      // given
      const f = fixture()
      f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: process.cwd(), name: existing })
      const run = runner(f)

      // when / then
      expect(await run("thread_create", { name: requested }, undefined, "call-create")).toMatchObject({
        kind: "error",
        error: { code: "name_conflict" },
      })
      expect(await run("thread_rename", { thread: "peer", name: requested }, undefined, "call-rename")).toMatchObject({
        kind: "error",
        error: { code: "name_conflict" },
      })
      expect(f.setSessionName).not.toHaveBeenCalled()
    },
  )

  test("rename allows keeping its own name", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "peer", name: "PEER" })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      name: "PEER",
    })
  })

  test("rename rejects whitespace-only names without a host mutation", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "peer", name: "   " })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test("rename conflict checks only visible threads unless all_scope widens visibility", async () => {
    const f = fixture()
    const otherWorkspace = mkdtempSync(join(tmpdir(), "thread-rename-scope-"))
    directories.push(otherWorkspace)
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: otherWorkspace, name: "Taken" })
    const run = runner(f)
    expect(await run("thread_rename", { thread: "dur-peer", name: "Taken" })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      name: "Taken",
    })
    expect(
      await run("thread_rename", { thread: "dur-peer", name: "Taken", all_scope: true }, undefined, "call-2"),
    ).toMatchObject({ kind: "error", error: { code: "name_conflict" } })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test.each(["GPT-X", "gPt X"])("set_model resolves a unique id or display-name pattern %s", async (model) => {
    const f = fixture()
    expect(await runner(f)("thread_set_model", { thread: "peer", model })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      model: { provider: "openai", id: "gpt-x" },
    })
    expect(f.getAvailableModels.mock.calls).toEqual([["route-peer"]])
    expect(f.setModel.mock.calls).toEqual([["route-peer", "openai", "gpt-x", "dur-peer"]])
  })

  test("set_model reports no match with at most twenty available provider/id values", async () => {
    const f = fixture()
    f.models.splice(
      0,
      f.models.length,
      ...Array.from({ length: 25 }, (_, index) => ({ provider: "test", id: `model-${index}` })),
    )
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "missing" })).toMatchObject({
      kind: "error",
      error: {
        code: "model_not_found",
        details: { available: f.models.slice(0, 20).map((model) => `${model.provider}/${model.id}`) },
      },
    })
    expect(f.setModel).not.toHaveBeenCalled()
  })

  test("set_model reports two matches as ambiguous rather than choosing the first", async () => {
    const f = fixture()
    f.models.push({ provider: "other", id: "gpt-y" })
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "gpt" })).toMatchObject({
      kind: "error",
      error: { code: "model_ambiguous", details: { candidates: ["openai/gpt-x", "other/gpt-y"] } },
    })
    expect(f.setModel).not.toHaveBeenCalled()
  })

  test("set_model ambiguity details contain at most ten candidates", async () => {
    const f = fixture()
    f.models.splice(
      0,
      f.models.length,
      ...Array.from({ length: 15 }, (_, index) => ({ provider: "test", id: `model-${index}` })),
    )
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "model" })).toMatchObject({
      kind: "error",
      error: {
        code: "model_ambiguous",
        details: { candidates: f.models.slice(0, 10).map((model) => `${model.provider}/${model.id}`) },
      },
    })
    expect(f.setModel).not.toHaveBeenCalled()
  })

  test.each(["openai/gpt-x", "gpt-x"])("set_model gives exact reference %s priority over fragments", async (model) => {
    const f = fixture()
    f.models.push({ provider: "openai", id: "gpt-x-mini" })
    expect(await runner(f)("thread_set_model", { thread: "peer", model })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      model: { provider: "openai", id: "gpt-x" },
    })
    expect(f.setModel.mock.calls).toEqual([["route-peer", "openai", "gpt-x", "dur-peer"]])
  })

  test("set_model provider narrows a fragment shared across providers", async () => {
    const f = fixture()
    f.models.push({ provider: "other", id: "gpt-y" })
    expect(await runner(f)("thread_set_model", { thread: "peer", model: "gpt", provider: "other" })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      model: { provider: "other", id: "gpt-y" },
    })
    expect(f.setModel.mock.calls).toEqual([["route-peer", "other", "gpt-y", "dur-peer"]])
  })

  test("set_model refuses a cross-workspace id until all_scope is supplied", async () => {
    const f = fixture()
    const otherWorkspace = mkdtempSync(join(tmpdir(), "thread-model-scope-"))
    directories.push(otherWorkspace)
    f.sessions.push({ sessionId: "route-other", durableSessionId: "dur-other", cwd: otherWorkspace, name: "other" })
    const run = runner(f)
    expect(await run("thread_set_model", { thread: "dur-other", model: "gpt-x" })).toMatchObject({
      kind: "error",
      error: { code: "scope_denied" },
    })
    expect(f.getAvailableModels).not.toHaveBeenCalled()
    expect(f.setModel).not.toHaveBeenCalled()
    expect(
      await run("thread_set_model", { thread: "dur-other", model: "gpt-x", all_scope: true }, undefined, "call-2"),
    ).toMatchObject({ kind: "ok", thread: "dur-other" })
    expect(f.setModel.mock.calls).toEqual([["route-other", "openai", "gpt-x", "dur-other"]])
  })

  test.each([undefined, "session", "turn"] as const)(
    "set_reasoning sends the session-only engine scope and echoes scope %s",
    async (scope) => {
      const f = fixture()
      expect(
        await runner(f)("thread_set_reasoning", {
          thread: "peer",
          level: "high",
          ...(scope === undefined ? {} : { scope }),
        }),
      ).toEqual({ kind: "ok", thread: "dur-peer", level: "high", scope: scope ?? "session" })
      expect(f.setThinkingLevel.mock.calls).toEqual([["route-peer", "high", "turn", "dur-peer"]])
      expect(f.getAvailableThinkingLevels).not.toHaveBeenCalled()
    },
  )

  test("set_reasoning classifies unsupported levels with the host's supported list and replays the rejection", async () => {
    const f = fixture()
    f.setThinkingLevel.mockImplementation(async () => {
      throw new Error("thinking_level_unsupported:Thinking level low is not supported by the active model.")
    })
    const run = runner(f)
    const args = { thread: "peer", level: "low", idempotency_key: "reject-low" }
    const result = await run("thread_set_reasoning", args)
    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "thinking_level_unsupported",
        details: { supported: ["off", "high"] },
        next_action: expect.any(String),
      },
    })
    expect(await run("thread_set_reasoning", args, undefined, "call-2")).toEqual(result)
    expect(f.setThinkingLevel).toHaveBeenCalledTimes(1)
    expect(f.getAvailableThinkingLevels.mock.calls).toEqual([["route-peer"]])
  })

  test("unclassified reasoning failures remain internal_error data", async () => {
    const f = fixture()
    f.setThinkingLevel.mockImplementation(async () => {
      throw new Error("connection lost")
    })
    expect(await runner(f)("thread_set_reasoning", { thread: "peer", level: "high" })).toMatchObject({
      kind: "error",
      error: { code: "internal_error" },
    })
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
    expect(result).toMatchObject({ kind: "ok", thread: "dur-peer" })
    if (name === "thread_rename") expect(f.setSessionName.mock.calls).toEqual([["route-peer", "New Name", "dur-peer"]])
  })

  test.each([
    { name: "thread_send", args: { thread: "self", message: "hello" } },
    { name: "thread_handoff", args: { thread: "self", message: "hello" } },
  ] as const)(
    "$name to self resolves the caller, and the gateway refuses a session delivering to itself",
    async ({ name, args }) => {
      const f = fixture()
      expect(await runner(f)(name, args, "dur-peer")).toMatchObject({
        kind: "error",
        error: { code: "loop_detected", details: { guard: "self_send" } },
      })
      expect(f.prompt).not.toHaveBeenCalled()
    },
  )

  test("self without a known caller fails closed instead of matching a thread named self", async () => {
    const f = fixture()
    f.sessions[0] = { ...f.sessions[0], name: "self" }
    expect(await runner(f)("thread_rename", { thread: "self", name: "New Name" })).toMatchObject({
      kind: "error",
      error: { code: "caller_context_missing" },
    })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test("#given the caller is dur-peer #when thread_rename omits thread #then this session is renamed", async () => {
    const f = fixture()
    expect(await runner(f, "dur-peer")("thread_rename", { name: "릴레이 테스트" })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      name: "릴레이 테스트",
    })
    expect(f.setSessionName.mock.calls).toEqual([["route-peer", "릴레이 테스트", "dur-peer"]])
  })

  test("#given the live session id is route-peer #when thread_rename names that sessionId #then the durable thread is renamed", async () => {
    const f = fixture()
    expect(await runner(f)("thread_rename", { thread: "route-peer", name: "릴레이 테스트" })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      name: "릴레이 테스트",
    })
  })

  test("#given rpc-9 is not a listed sessionId #when thread_rename names it #then not_found suggests the thread value", async () => {
    const f = fixture()
    const result = await runner(f)("thread_rename", { thread: "rpc-9", name: "릴레이 테스트" })
    expect(result).toMatchObject({ kind: "error", error: { code: "not_found" } })
    if (result.kind !== "error") throw new Error("expected not_found")
    expect(result.error.message).toContain("dur-peer")
    expect(result.error.next_action).toContain("thread value")
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test("self uses the callerSessionId fallback when no execution context is supplied", async () => {
    const f = fixture()
    expect(await runner(f, "dur-peer")("thread_rename", { thread: "self", name: "New Name" })).toEqual({
      kind: "ok",
      thread: "dur-peer",
      name: "New Name",
    })
  })

  test("the unknown-caller placeholder is an absent identity, not an addressable id", async () => {
    // A placeholder that matches a real entry would let "self" act on a thread the caller does
    // not own, so the sentinel must fail closed even when some thread carries it as its id.
    const f = fixture()
    f.sessions[0] = { ...f.sessions[0], durableSessionId: "unknown-caller" }
    expect(await runner(f)("thread_rename", { thread: "self", name: "hijacked" })).toMatchObject({
      kind: "error",
      error: { code: "caller_context_missing" },
    })
    expect(f.setSessionName).not.toHaveBeenCalled()
  })

  test.each([
    {
      name: "thread_rename",
      args: { thread: "dur-peer", name: "New Name", idempotency_key: "shared-key" },
      calls: "setSessionName",
    },
    {
      name: "thread_set_model",
      args: { thread: "dur-peer", model: "gpt-x", idempotency_key: "shared-key" },
      calls: "setModel",
    },
    {
      name: "thread_set_reasoning",
      args: { thread: "dur-peer", level: "high", idempotency_key: "shared-key" },
      calls: "setThinkingLevel",
    },
  ] as const)(
    "$name receipts replay for one caller but remain isolated between execution contexts",
    async ({ name, args, calls }) => {
      const f = fixture()
      const run = runner(f)
      const first = await run(name, args, "caller-a", "call-1")
      expect(first.kind).toBe("ok")
      expect(await run(name, args, "caller-a", "call-2")).toMatchObject(first)
      expect(f[calls]).toHaveBeenCalledTimes(1)
      expect((await run(name, args, "caller-b", "call-1")).kind).toBe("ok")
      expect(f[calls]).toHaveBeenCalledTimes(2)
    },
  )

  test("fuzzy handoff excludes the caller even when its own name is the strongest match", async () => {
    const f = fixture()
    f.sessions[0] = { ...f.sessions[0], name: "payments worker" }
    f.sessions.push({
      sessionId: "route-self",
      durableSessionId: "dur-self",
      cwd: process.cwd(),
      name: "payments work",
    })
    expect(
      await runner(f)("thread_handoff", { thread: "payments work", match: "fuzzy", message: "continue" }, "dur-self"),
    ).toMatchObject({ kind: "ok", thread: "dur-peer", resolved_by: "fuzzy" })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  test("#given the best fuzzy match is a session in another workspace #when handing off without all_scope #then the best match in this workspace is chosen, and all_scope reaches the other one", async () => {
    // given
    const f = fixture()
    const otherWorkspace = mkdtempSync(join(tmpdir(), "thread-fuzzy-scope-"))
    directories.push(otherWorkspace)
    f.sessions[0] = { ...f.sessions[0], name: "unrelated notes" }
    f.sessions.push({ sessionId: "route-far", durableSessionId: "dur-far", cwd: otherWorkspace, name: "payments work" })
    f.sessions.push({
      sessionId: "route-near",
      durableSessionId: "dur-near",
      cwd: process.cwd(),
      name: "payments worker",
    })
    const run = runner(f)

    // when
    const scoped = await run(
      "thread_handoff",
      { thread: "payments work", match: "fuzzy", message: "continue" },
      "dur-self",
      "call-scoped",
    )
    const wide = await run(
      "thread_handoff",
      { thread: "payments work", match: "fuzzy", message: "continue", all_scope: true },
      "dur-self",
      "call-wide",
    )

    // then
    expect(scoped).toMatchObject({ kind: "ok", thread: "dur-near", resolved_by: "fuzzy" })
    expect(wide).toMatchObject({ kind: "ok", thread: "dur-far", resolved_by: "fuzzy" })
  })

  test("#given a caller with no workspace root #when a fuzzy handoff runs without all_scope #then it is caller_context_missing, as the exact ladder answers, not not_found", async () => {
    // given
    const f = fixture()
    f.sessions.push({ sessionId: "route-self", durableSessionId: "dur-self", cwd: process.cwd(), name: "self" })

    // when
    const result = await runner(f, "unknown-caller", "")(
      "thread_handoff",
      { thread: "peer", match: "fuzzy", message: "continue" },
      "dur-self",
      "call-blank-root",
    )

    // then
    expect(result).toMatchObject({
      kind: "error",
      error: { code: "caller_context_missing", next_action: expect.stringContaining("all_scope") },
    })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  test("fuzzy handoff cannot select the caller when it is the only candidate", async () => {
    const f = fixture()
    expect(
      await runner(f)("thread_handoff", { thread: "peer", match: "fuzzy", message: "continue" }, "dur-peer"),
    ).toMatchObject({ kind: "error", error: { code: "not_found" } })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  test("thread_list returns host failures as data, flagged isError so the caller's tool result reads as failed", async () => {
    const f = fixture()
    const list = (callId: string) => {
      const [tool] = createThreadTools({
        ...f,
        callerSessionId: () => "unknown-caller",
        callerWorkspaceRoot: () => process.cwd(),
      }).filter((candidate) => candidate.name === "thread_list")
      if (tool === undefined) throw new Error("thread_list must be registered")
      return tool.execute(callId, {}, undefined, undefined, undefined as never)
    }
    const ok = await list("call-ok")
    expect(ok.details.result).toMatchObject({ kind: "ok" })
    expect(ok.isError).toBeUndefined()
    f.host = {
      ...f.host,
      listSessions: async () => {
        throw new Error("host_unavailable:/missing.sock")
      },
    }
    const failed = await list("call-failed")
    expect(failed.details.result).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(failed.isError).toBe(true)
  })
})

const TUI_SOCKET = "/tmp/t-0123456789abcdef.sock"
const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"

/** A host session (the caller) and a terminal session, each on its own endpoint, with a recording gateway port. */
function gatewayFixture(store?: GatewayStore) {
  const f = fixture()
  const hostSession: ThreadHostSession = {
    sessionId: "rpc-1",
    durableSessionId: "dur-host",
    cwd: process.cwd(),
    name: "host lane",
    status: "open",
    socket: HOST_SOCKET,
    endpoint_kind: "rpc_host",
  }
  const tuiSession: ThreadHostSession = {
    sessionId: "dur-tui",
    durableSessionId: "dur-tui",
    cwd: process.cwd(),
    name: "my-tui",
    status: "open",
    socket: TUI_SOCKET,
    endpoint_kind: "tui",
  }
  const sessionsDir = join(f.stateDirectory, "sessions", "--fixture--")
  mkdirSync(sessionsDir, { recursive: true })
  for (const session of [hostSession, tuiSession])
    writeFileSync(
      join(sessionsDir, `epoch_${session.durableSessionId}.jsonl`),
      JSON.stringify({
        type: "session",
        id: session.durableSessionId,
        cwd: session.cwd,
        timestamp: "2026-10-02T00:00:00Z",
      }) + "\n",
    )
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
  const run = async (
    name: ThreadToolName,
    args: unknown,
    callerId: string,
    callId: string,
    callerName?: string,
  ): Promise<ThreadToolResult> => {
    const tools = createThreadTools({
      host,
      stateDirectory: f.stateDirectory,
      sessionsDirectory: () => join(f.stateDirectory, "sessions"),
      store: store ?? f.store,
      callerSessionId: () => callerId,
      callerWorkspaceRoot: () => process.cwd(),
      callerName: () => callerName,
    })
    const tool = tools.find((candidate) => candidate.name === name)
    const result = await tool!.execute(callId, args, undefined, undefined, {
      sessionManager: { getSessionId: () => callerId },
    } as never)
    return result.details.result as ThreadToolResult
  }
  /** Binds a chat thread to `session` straight through the store, as the gateway does; no session tool binds. */
  const bind = async (session: string, chat: Omit<BindInput, "session_durable_id">): Promise<string> => {
    const binding = normalizeBindInput({ ...chat, session_durable_id: session })
    if ("kind" in binding) throw new Error(JSON.stringify(binding))
    const bound = await f.store.bind({ now: Date.now(), receipt: null, binding })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    return bound.binding.binding_id
  }
  return { f, wakes, run, bind }
}

describe("thread_send through the session gateway", () => {
  test("#given a host session and a terminal endpoint #when the host session sends to the terminal #then the result carries delivery_id, no endpoint internals, and only a wake reached the terminal", async () => {
    const g = gatewayFixture()
    const result = await g.run("thread_send", { thread: "my-tui", message: "hello terminal" }, "dur-host", "call-1")
    // The fixture's wake answers with nothing admitted and no drain behind it, so nothing will start the message (#12486).
    expect(result).toMatchObject({
      kind: "ok",
      thread: "dur-tui",
      effective_mode: "auto",
      delivery: { kind: "queued_offline" },
      deduplicated: false,
    })
    const deliveryId = (result as { delivery_id?: string }).delivery_id
    expect(typeof deliveryId).toBe("string")
    expect(g.wakes).toEqual([
      {
        endpoint: { kind: "tui", socket: TUI_SOCKET, routing_id: "dur-tui", durable_session_id: "dur-tui" },
        ids: [deliveryId as string],
      },
    ])
    expect(g.f.prompt).not.toHaveBeenCalled()
    const rows = await g.f.store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => ({ id: row.delivery_id, state: row.state, sender: row.sender }))).toEqual([
      { id: deliveryId as string, state: "queued", sender: "session:dur-host" },
    ])
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

  test("#given a named caller and an unnamed one #when each sends to a terminal #then the receiver is told the sending session's id and, only when it has one, its current name", async () => {
    const g = gatewayFixture()
    await g.run("thread_send", { thread: "dur-tui", message: "from the planner" }, "dur-host", "call-1", "  planner ")
    await g.run("thread_send", { thread: "dur-tui", message: "from an unnamed session" }, "dur-other", "call-2")
    const rows = await g.f.store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => ({ body: row.body, sender: deliverySender(row) }))).toEqual([
      { body: "from the planner", sender: { kind: "agent", session_id: "dur-host", name: "planner" } },
      { body: "from an unnamed session", sender: { kind: "agent", session_id: "dur-other" } },
    ])
  })

  test("#given the gateway send path #when a session sends to itself #then it is refused loop_detected before any row is written", async () => {
    const g = gatewayFixture()
    expect(await g.run("thread_send", { thread: "self", message: "echo" }, "dur-tui", "call-1")).toMatchObject({
      kind: "error",
      error: { code: "loop_detected" },
    })
    expect(await g.f.store.list({ target_durable_id: "dur-tui" })).toEqual([])
  })
})

describe("relay tools over the gateway store", () => {
  test("#given the gateway bound a chat thread to session B #when B reports a milestone #then a connector reads it with the binding revision and a cursor and acks it", async () => {
    const g = gatewayFixture()
    const bindingId = await g.bind("dur-tui", { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1" })
    const reported = await g.run(
      "thread_report",
      { binding_id: bindingId, kind: "milestone", text: "done step 1" },
      "dur-tui",
      "call-2",
    )
    expect(reported).toMatchObject({ kind: "ok", binding_id: bindingId, revision: 1, event: "milestone" })
    const read = await g.run("thread_outbox", { binding_id: bindingId }, "connector", "call-3")
    expect(read).toMatchObject({
      kind: "ok",
      rows: [{ event: "milestone", text: "done step 1", revision: 1, cursor: (reported as { cursor: number }).cursor }],
    })
    expect(
      await g.run(
        "thread_outbox_ack",
        { binding_id: bindingId, cursor: (reported as { cursor: number }).cursor },
        "connector",
        "call-4",
      ),
    ).toMatchObject({ kind: "ok", changed: true })
    expect(await g.run("thread_outbox", { binding_id: bindingId }, "connector", "call-5")).toMatchObject({
      kind: "ok",
      rows: [],
    })
  })

  test("#given a binding of session B #when another session reports through it #then it is scope_denied and the outbox stays empty", async () => {
    const g = gatewayFixture()
    const bindingId = await g.bind("dur-tui", { platform: "discord", account_id: "bot", chat_id: "c9" })
    expect(
      await g.run("thread_report", { binding_id: bindingId, kind: "report", text: "not mine" }, "dur-host", "call-2"),
    ).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(await g.run("thread_outbox", { binding_id: bindingId }, "connector", "call-3")).toMatchObject({
      kind: "ok",
      rows: [],
    })
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
        throw Object.assign(
          new Error(
            "gateway store lock wait exceeded: tool_receipt_settle waited 25000 ms for the write lock (limit 30000 ms); another process holds it",
          ),
          { code: "gateway_lock_wait_exceeded" },
        )
      },
    }
    const run = runner({ ...f, store }, "caller")
    expect(
      await run("thread_rename", { thread: "peer", name: "Renamed", idempotency_key: "rename-1" }, "caller"),
    ).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    const retried = await run(
      "thread_rename",
      { thread: "peer", name: "Renamed", idempotency_key: "rename-1" },
      "caller",
    )
    expect(retried).toMatchObject({
      kind: "error",
      error: {
        code: "idempotency_uncertain",
        details: { error_note: expect.stringContaining("could not be recorded") },
      },
    })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given the store fails while admitting a receipted call's receipt #when the tool runs #then it answers overloaded for a lock-wait and internal_error otherwise, as data, runs nothing, and a later call runs once", async () => {
    const f = fixture()
    const real = f.store
    const failures: Error[] = [
      Object.assign(
        new Error(
          "gateway store lock wait exceeded: tool_receipt_begin waited 25000 ms for the write lock (limit 30000 ms); another process holds it",
        ),
        { code: "gateway_lock_wait_exceeded" },
      ),
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
    expect(await run("thread_rename", args, "caller")).toMatchObject({
      kind: "error",
      error: { code: "internal_error" },
    })
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(await run("thread_rename", args, "caller")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
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
    expect(await run("thread_rename", args, "caller")).toMatchObject({
      kind: "error",
      error: { code: "internal_error" },
    })
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(await run("thread_rename", args, "caller")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(await run("thread_rename", args, "caller")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  /**
   * A registered surface over a store whose receipt admission can fail before writing (`fail`), after committing (`lost-reply`),
   * or after committing and then waiting until `releaseHeld` before its reply is lost (`held`).
   */
  function recoverySurface(f: ReturnType<typeof fixture>, clock: { now: number }) {
    const real = f.store
    const admissions = { mode: "real" as "real" | "fail" | "lost-reply" | "held" }
    const held: Array<() => void> = []
    const heldWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
    /** Resolves once `count` held admissions have committed their receipt and are waiting. */
    const whenHeld = (count: number) =>
      new Promise<void>((resolve) => {
        if (held.length >= count) resolve()
        else heldWaiters.push({ count, resolve })
      })
    const releaseHeld = () => {
      for (const release of held.splice(0)) release()
    }
    const store: GatewayStore = {
      ...real,
      toolReceiptBegin: async (request) => {
        const mode = admissions.mode
        if (mode === "fail") throw new Error("the gateway store worker exited (1)")
        const admission = await real.toolReceiptBegin(request)
        if (mode === "held") {
          const { promise, resolve } = Promise.withResolvers<void>()
          held.push(resolve)
          for (const waiter of heldWaiters.filter((candidate) => held.length >= candidate.count)) waiter.resolve()
          await promise
        }
        if (mode === "lost-reply" || mode === "held") throw new Error("the gateway store worker exited (1)")
        return admission
      },
    }
    const tools: Record<string, unknown>[] = []
    const surface = registerThreadTools(
      { registerTool: (tool) => tools.push(tool) },
      { ...f, store, now: () => clock.now, callerSessionId: () => "caller", callerWorkspaceRoot: () => process.cwd() },
    )
    const rename = async (key: string): Promise<ThreadToolResult> => {
      const tool = tools.find((candidate) => candidate.name === "thread_rename") as {
        execute: (...args: unknown[]) => Promise<{ details: { result: ThreadToolResult } }>
      }
      return (
        await tool.execute(
          `call-${key}`,
          { thread: "dur-peer", name: "Renamed", idempotency_key: key },
          undefined,
          undefined,
          { sessionManager: { getSessionId: () => "caller" } },
        )
      ).details.result
    }
    /** `count` calls whose admissions fail without a reply and without a receipt. */
    const failMany = async (prefix: string, count: number) => {
      admissions.mode = "fail"
      for (let index = 0; index < count; index++)
        expect(await rename(`${prefix}-${index}`)).toMatchObject({ kind: "error", error: { code: "internal_error" } })
      admissions.mode = "real"
    }
    return { admissions, rename, failMany, whenHeld, releaseHeld, dispose: surface.dispose }
  }

  test("#given one slot left in the recovery bound #when two calls under new keys overlap and both lose their committed admission replies #then exactly one is admitted and kept for recovery, the other is refused overloaded before its admission, and no more than the bound is ever kept", async () => {
    const f = fixture()
    const s = recoverySurface(f, { now: Date.now() })
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS - 1)
    s.admissions.mode = "held"
    const first = s.rename("actual-a")
    await s.whenHeld(1)
    const second = s.rename("actual-b")
    // Either the second call is answered without reaching the store, or its admission commits and waits beside the first.
    const raced = await Promise.race([
      second.then((result) => ({ answeredBeforeAdmission: result })),
      s.whenHeld(2).then(() => ({ answeredBeforeAdmission: undefined })),
    ])
    s.releaseHeld()
    s.admissions.mode = "real"

    expect(await first).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(raced.answeredBeforeAdmission).toMatchObject({
      kind: "error",
      error: { code: "overloaded", details: { budget: "receipt_recovery", max_keys: RECEIPT_RECOVERY_MAX_KEYS } },
    })
    expect(await second).toEqual(raced.answeredBeforeAdmission as ThreadToolResult)
    expect(f.setSessionName).not.toHaveBeenCalled()
    // The bound is full with the fill keys and actual-a: a new key is refused until actual-a recovers, which frees exactly one slot.
    expect(await s.rename("fresh-1")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    expect(await s.rename("actual-a")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(await s.rename("fresh-2")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(2)
  })

  test("#given one slot left in the recovery bound #when two calls under the same key overlap and both lose their admission replies #then they share that one slot: both reach the store, the key recovers once, and the next new key runs", async () => {
    const f = fixture()
    const s = recoverySurface(f, { now: Date.now() })
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS - 1)
    s.admissions.mode = "held"
    const first = s.rename("shared")
    await s.whenHeld(1)
    const second = s.rename("shared")
    const raced = await Promise.race([
      second.then((result) => ({ answeredBeforeAdmission: result })),
      s.whenHeld(2).then(() => ({ answeredBeforeAdmission: undefined })),
    ])
    expect(raced.answeredBeforeAdmission).toBeUndefined()
    s.releaseHeld()
    s.admissions.mode = "real"

    expect(await first).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(await second).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(await s.rename("fresh-1")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    expect(await s.rename("shared")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(await s.rename("fresh-2")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(2)
  })

  test("#given as many keys as the recovery bound whose admissions failed without a reply #when a call under a new key arrives #then it is refused overloaded and runs nothing, the oldest key still recovers, and a new key runs once that frees a slot", async () => {
    const f = fixture()
    const s = recoverySurface(f, { now: Date.now() })
    s.admissions.mode = "lost-reply"
    expect(await s.rename("lost-oldest")).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS - 1)

    expect(await s.rename("new")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(await s.rename("lost-oldest")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(await s.rename("new")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
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
    expect(await s.rename("at-expiry")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given the recovery bound filled by failed admissions #when the tool surface is disposed #then its recovery keys are released and a call under a new key runs", async () => {
    const f = fixture()
    const s = recoverySurface(f, { now: Date.now() })
    await s.failMany("fill", RECEIPT_RECOVERY_MAX_KEYS)
    expect(await s.rename("before-dispose")).toMatchObject({ kind: "error", error: { code: "overloaded" } })
    s.dispose()
    expect(await s.rename("after-dispose")).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given a call still running under a key #when a second invocation of the key loses its receipt reply and a third retries #then the retry is idempotency_in_progress and the side effect runs once", async () => {
    const f = fixture()
    const real = f.store
    let begins = 0
    let releaseRename: () => void = () => undefined
    const renameHeld = new Promise<void>((resolve) => {
      releaseRename = resolve
    })
    let renameStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      renameStarted = resolve
    })
    f.setSessionName.mockImplementation(async (sessionId: string, name: string, _durableId?: string) => {
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
    expect(await run("thread_rename", args, "caller")).toMatchObject({
      kind: "error",
      error: { code: "internal_error" },
    })
    expect(await run("thread_rename", args, "caller")).toMatchObject({
      kind: "error",
      error: { code: "idempotency_in_progress" },
    })
    releaseRename()
    expect(await first).toEqual({ kind: "ok", thread: "dur-peer", name: "Renamed" })
    expect(f.setSessionName).toHaveBeenCalledTimes(1)
  })
})

describe("thread tools over a gateway store a newer omo build migrated", () => {
  function newerStore(ahead: number) {
    const agentDir = mkdtempSync(join(tmpdir(), "thread-tools-newer-schema-"))
    directories.push(agentDir)
    const versions = storeMigratedByNewerBuild(agentDir, ahead)
    const store = createGatewayStore({ agentDir })
    stores.push(store)
    return { store, agentDir, ...versions }
  }

  test.each([1, 3])(
    "#given the agent dir's store is %i schema version(s) past this binary's #when thread_send and a receipted tool run #then each answers gateway_schema_too_new naming both schemas and the update command, and the store keeps its schema",
    async (ahead) => {
      // given: the old-binary fixture, a store a newer build migrated past every schema this build knows (N+1 is the next schema)
      const n = newerStore(ahead)
      const g = gatewayFixture(n.store)
      const refusal = {
        kind: "error",
        error: {
          code: "gateway_schema_too_new",
          details: { gateway_schema: n.gateway, binary_schema: n.binary, update_command: "omo update" },
        },
      }

      // when
      const sent = await g.run("thread_send", { thread: "my-tui", message: "hello" }, "dur-host", "call-1")
      const renamed = await g.run("thread_rename", { thread: "my-tui", name: "renamed" }, "dur-host", "call-2")

      // then
      // the hint carries the command (read before toMatchObject, which writes its asymmetric matchers into the received object)
      for (const result of [sent, renamed]) {
        const error = (result as { readonly error: ThreadToolFailure }).error
        expect(error.next_action).toContain(String(error.details?.update_command))
      }
      expect(sent).toMatchObject(refusal)
      expect(renamed).toMatchObject(refusal)
      // A read-write connection: the refused store closed its WAL connection, which removed -wal and -shm, and a
      // read-only connection cannot recreate them (macOS's system SQLite answers SQLITE_CANTOPEN). It only reads.
      const db = new Database(gatewayDatabasePath(n.agentDir))
      try {
        expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: n.gateway })
      } finally {
        db.close()
      }
    },
  )

  test.each([
    ["thread_outbox_ack", { binding_id: "bnd-1", cursor: 3, provider_message_id: "m-1" }],
    ["thread_report", { kind: "milestone", text: "done step 1" }],
    ["thread_outbox", { binding_id: "bnd-1", after_cursor: 0 }],
  ] as const)(
    "#given the agent dir's store is one schema version past this binary's #when the relay tool %s runs #then it answers gateway_schema_too_new naming both schemas and omo update",
    async (name, args) => {
      const n = newerStore(1)
      const g = gatewayFixture(n.store)
      expect(await g.run(name, args, "dur-host", "call-relay")).toMatchObject({
        kind: "error",
        error: {
          code: "gateway_schema_too_new",
          details: { gateway_schema: n.gateway, binary_schema: n.binary, update_command: "omo update" },
        },
      })
    },
  )
})

describe("receipts stored before one field named a session (#14044 4a)", () => {
  /** Writes a settled receipt through the real store under the key a retry of `args` uses, as an earlier build would. */
  async function stored(
    f: ReturnType<typeof fixture>,
    operation: ThreadToolName,
    args: Record<string, unknown>,
    result: unknown,
  ): Promise<void> {
    const parsed = parseThreadParams(threadToolParamSchemas[operation], args)
    if (parsed.kind !== "ok") throw new Error(`invalid ${operation} args`)
    const scope = { principal: "session:caller", operation, idempotency_key: String(args["idempotency_key"]) }
    expect(await f.store.toolReceiptBegin({ ...scope, now: Date.now(), args_hash: hashArgs(parsed.value) })).toEqual({
      kind: "accepted",
    })
    await f.store.toolReceiptSettle({ ...scope, now: Date.now(), result: result as ThreadToolResult })
  }

  test("#given thread_create, thread_list, thread_rename and an ambiguous thread_read receipts stored in the old shape #when the same keys are retried #then each replays the current shape: thread is the address string and no endpoint internal comes back", async () => {
    // given: receipts written by a build before #14044, under the keys the retries below use
    const f = fixture()
    const created = { name: "old create", idempotency_key: "create-before-14044" }
    const listed = { idempotency_key: "list-before-14044" }
    const renamed = { thread: "peer", name: "Renamed", idempotency_key: "rename-before-14044" }
    const ambiguous = { thread: "twin", idempotency_key: "read-before-14044" }
    const oldRow = {
      sessionId: "route-peer",
      durableSessionId: "dur-peer",
      thread_id: "dur-peer",
      name: "old create",
      status: "live",
      cwd: "/w",
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z",
      socket: "/tmp/thread-tools-test.sock",
      endpoint_kind: "rpc_host",
      endpoint: { kind: "rpc_host", socket: "/tmp/thread-tools-test.sock", routing_id: "route-peer" },
      surface: "daemon",
      alive: true,
    }
    await stored(f, "thread_create", created, {
      kind: "ok",
      thread: { ...oldRow, requested_skills: ["lead"] },
      deduplicated: false,
      prompt: { delivery: { kind: "started", turn_id: "1" }, deduplicated: false, endpoint: { kind: "rpc_host" } },
    })
    await stored(f, "thread_list", listed, { kind: "ok", threads: [oldRow], scope: "workspace" })
    await stored(f, "thread_rename", renamed, { kind: "ok", thread_id: "dur-peer", name: "Renamed" })
    const oldCandidates = [
      { id: "dur-twin-1", name: "twin", cwd: "/w", preview: "", updatedAt: null, state: "live" },
      { id: "dur-twin-2", name: "twin", cwd: "/w", preview: "", updatedAt: null, state: "live" },
    ]
    await stored(f, "thread_read", ambiguous, {
      kind: "error",
      error: {
        code: "ambiguous_target",
        message: "Two threads are named twin.",
        next_action: "Pass one thread.",
        details: { candidates: oldCandidates },
      },
    })

    // when
    const run = runner(f, "caller")
    const replayed = {
      create: await run("thread_create", created, "caller"),
      list: await run("thread_list", listed, "caller"),
      rename: await run("thread_rename", renamed, "caller"),
      read: await run("thread_read", ambiguous, "caller"),
    }

    // then: the whole result, in the shape a current call answers
    const row = {
      thread: "dur-peer",
      name: "old create",
      status: "live",
      cwd: "/w",
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z",
      link: "[old create](omo-thread://v1/dur-peer)",
      surface: "daemon",
      state: "idle",
    }
    const candidates = oldCandidates.map(({ id, ...rest }) => ({ thread: id, ...rest }))
    expect(replayed).toStrictEqual({
      create: {
        kind: "ok",
        ...row,
        requested_skills: ["lead"],
        deduplicated: false,
        prompt: { delivery: { kind: "started", turn_id: "1" }, deduplicated: false },
      },
      list: { kind: "ok", threads: [row], scope: "workspace" },
      rename: { kind: "ok", thread: "dur-peer", name: "Renamed" },
      read: {
        kind: "error",
        error: {
          code: "ambiguous_target",
          message: "Two threads are named twin.",
          next_action: "Pass one thread.",
          details: { candidates },
        },
      },
    } as unknown as typeof replayed)
    expect(f.setSessionName).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
  })

  test("#given receipts stored in the current shape #when the same keys are retried #then each replays byte-identical to what was stored", async () => {
    // given: results a current build wrote, success and refusal alike
    const f = fixture()
    const row = {
      thread: "dur-peer",
      name: "peer",
      status: "live",
      cwd: "/w",
      created_at: "2026-11-17T00:00:00.000Z",
      updated_at: null,
      link: "[peer](omo-thread://v1/dur-peer)",
      surface: "daemon",
      state: "idle",
      controls: ["send", "read"],
    }
    const receipts = [
      {
        operation: "thread_create" as const,
        args: { name: "peer", idempotency_key: "create-current" },
        result: { kind: "ok", ...row, requested_skills: ["lead"], deduplicated: false },
      },
      {
        operation: "thread_list" as const,
        args: { idempotency_key: "list-current" },
        result: { kind: "ok", threads: [row], scope: "workspace", devices: [] },
      },
      {
        operation: "thread_rename" as const,
        args: { thread: "peer", name: "Renamed", idempotency_key: "rename-current" },
        result: { kind: "ok", thread: "dur-peer", name: "Renamed" },
      },
      {
        operation: "thread_read" as const,
        args: { thread: "twin", idempotency_key: "read-current" },
        result: {
          kind: "error",
          error: {
            code: "ambiguous_target",
            message: "Two threads are named twin.",
            next_action: "Pass one thread.",
            details: {
              candidates: [
                { thread: "dur-twin-1", name: "twin", cwd: "/w", preview: "", updatedAt: null, state: "live" },
              ],
            },
          },
        },
      },
    ]
    for (const receipt of receipts) await stored(f, receipt.operation, receipt.args, receipt.result)

    // when
    const run = runner(f, "caller")
    const replayed: string[] = []
    for (const receipt of receipts) replayed.push(JSON.stringify(await run(receipt.operation, receipt.args, "caller")))

    // then
    expect(replayed).toEqual(receipts.map((receipt) => JSON.stringify(receipt.result)))
    expect(f.setSessionName).not.toHaveBeenCalled()
  })
})

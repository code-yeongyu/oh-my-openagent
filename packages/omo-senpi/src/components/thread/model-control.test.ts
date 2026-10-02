import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createThreadComponent } from "./component"
import type { GatewayStoreEvent } from "./gateway/types"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadSdk, type ThreadSdk } from "./sdk"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

/**
 * #9425: a gateway session's model. Auto resolves from the connected providers before the session
 * opens and is passed to the host explicitly; an explicit choice wins and is recorded with who made
 * it; list/read report the model with its provenance; a runtime fallback switch writes one milestone
 * row to each outbound binding. Every test drives the SDK, the agent tool or the component the way a
 * connector, a lead session or the engine does, over a real gateway store.
 */

/**
 * The pinned engine's own session class, loaded from its dist like `senpi-test-runtime.ts` does: its model
 * switch and thinking-level clamp are what the gateway's record has to agree with.
 */
type EngineSessionClass = { readonly prototype: { _clampThinkingLevel(level: string, available: readonly string[]): string } }
const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { AgentSession } = (await import(pathToFileURL(join(senpiDist, "core", "agent-session.js")).href)) as { AgentSession: EngineSessionClass }
const { SessionManager } = (await import(pathToFileURL(join(senpiDist, "core", "session-manager.js")).href)) as { SessionManager: { inMemory(cwd?: string): EngineSessionManager } }
type EngineSessionManager = { getSessionId(): string }

const HOST_SOCKET = "/tmp/i-9425aaaaaaaaaaaa.sock"
const DEAD_SOCKET = "/tmp/i-9425dddddddddddd.sock"

const CATALOG = [
  { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", thinking_levels: ["off", "low", "medium", "high"] },
  { provider: "openai", id: "gpt-x", name: "GPT X", thinking_levels: ["off", "low", "medium", "high", "xhigh"] },
  { provider: "openai", id: "gpt-y", name: "GPT Y", thinking_levels: ["off", "low", "medium", "high", "xhigh"] },
] as const

type Catalog = readonly { readonly provider: string; readonly id: string; readonly name?: string; readonly thinking_levels?: readonly string[] }[]

const directories: string[] = []
const disposables: Array<{ dispose: () => Promise<void> }> = []
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((entry) => entry.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

/**
 * One rpc host holding `sessions`, whose catalog for a new session is `catalog` (only connected
 * providers, as get_available_models answers). `openSession` adds the session it opens; `reopen`
 * gives an existing durable id a new routing id, as a host restart and resume does.
 */
function fakeHost(options: { readonly catalog?: Catalog; readonly dead?: readonly string[]; readonly listsCatalog?: boolean } = {}) {
  const catalog = options.catalog ?? CATALOG
  const sessions: ThreadHostSession[] = [{ sessionId: "rpc-1", durableSessionId: "dur-lane", cwd: process.cwd(), name: "lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }]
  const thinking = new Map<string, string>([["rpc-1", "medium"]])
  const models = new Map<string, { provider: string; id: string }>([["rpc-1", { provider: "anthropic", id: "claude-opus-5-5" }]])
  let next = 2
  const openSession = mock(async (params: { readonly cwd?: string; readonly name?: string; readonly forkFrom?: string; readonly provider?: string; readonly modelId?: string; readonly thinkingLevel?: string }) => {
    const sessionId = `rpc-${next++}`
    const session: ThreadHostSession = { sessionId, durableSessionId: `dur-new-${sessionId}`, cwd: params.cwd ?? process.cwd(), name: params.name ?? null, status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
    sessions.push(session)
    thinking.set(sessionId, params.thinkingLevel ?? "high")
    if (params.provider !== undefined && params.modelId !== undefined) models.set(sessionId, { provider: params.provider, id: params.modelId })
    return { ...session, thinkingLevel: thinking.get(sessionId) } as ThreadHostSession
  })
  const setModel = mock(async (sessionId: string, provider: string, modelId: string) => {
    models.set(sessionId, { provider, id: modelId })
    return { provider, id: modelId }
  })
  const levelsOf = (sessionId: string) => catalog.find((entry) => entry.provider === models.get(sessionId)?.provider && entry.id === models.get(sessionId)?.id)?.thinking_levels ?? []
  // As senpi's rpc host answers set_thinking_level: `turn` refuses a level the active model cannot run before
  // changing anything; the session scope applies it through the session, which clamps it to a supported one.
  const setThinkingLevel = mock(async (sessionId: string, level: string, scope?: "session" | "turn") => {
    const supported = levelsOf(sessionId)
    if (scope === "turn" && !supported.includes(level)) throw new Error(`thinking_level_unsupported:Thinking level ${level} is not supported by the active model.`)
    thinking.set(sessionId, supported.length === 0 || supported.includes(level) ? level : AgentSession.prototype._clampThinkingLevel(level, supported))
  })
  const disk = (options.dead ?? []).map((id) => ({ durable_id: id, name: id, cwd: process.cwd(), created_at: "2026-10-01T00:00:00.000Z", updated_at: null, session_path: `/sessions/${id}.jsonl`, source_host: DEAD_SOCKET }))
  const host: ThreadHost = {
    socket: "/tmp/thread-9425-legacy.sock",
    listSessions: async () => sessions,
    listView: async () => ({
      sessions: [...sessions],
      hosts: [
        { socket: HOST_SOCKET, list_sessions: { sessions: [...sessions] }, endpoint_kind: "rpc_host", alive: true },
        ...(disk.length === 0 ? [] : [{ socket: DEAD_SOCKET, error: "connect ECONNREFUSED", endpoint_kind: "rpc_host" as const, alive: false, reason: "dead" as const }]),
      ],
      disk,
    }),
    openSession,
    ...(options.listsCatalog === false ? {} : { availableModels: async () => catalog }),
    getMessages: async () => [{ role: "user", content: "hello" }],
    getState: async (sessionId) => ({ isStreaming: false, thinkingLevel: thinking.get(sessionId) }),
    prompt: async () => ({}),
    interrupt: async () => ({ interrupted: false }),
    setSessionName: async () => {},
    setModel,
    getAvailableModels: async () => catalog,
    setThinkingLevel,
    getAvailableThinkingLevels: async (sessionId) => levelsOf(sessionId),
  }
  const reopen = (durableId: string) => {
    const index = sessions.findIndex((session) => session.durableSessionId === durableId)
    const sessionId = `rpc-${next++}`
    const previous = sessions[index]
    if (previous === undefined) throw new Error(`no session ${durableId}`)
    sessions[index] = { ...previous, sessionId }
    thinking.set(sessionId, thinking.get(previous.sessionId) ?? "medium")
    const model = models.get(previous.sessionId)
    if (model !== undefined) models.set(sessionId, model)
  }
  return { host, openSession, setModel, setThinkingLevel, models, reopen }
}

function sdkFixture(options: { readonly catalog?: Catalog; readonly dead?: readonly string[]; readonly profile?: string; readonly listsCatalog?: boolean } = {}) {
  const agentDir = scratch("thread-9425-sdk-")
  const store = createGatewayStore({ agentDir })
  const fake = fakeHost(options)
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host: fake.host, store, modelProfile: () => ({ model_profile: options.profile ?? "recommended" }) })
  disposables.push(sdk)
  return { ...fake, sdk, store, agentDir }
}

const threadOf = (result: unknown) => (result as { thread: { thread_id: string; model: unknown } }).thread

describe("#9425 spawn: auto from the connected providers", () => {
  test("#given no model #when a connector creates a session #then the profile ladder's best connected rung is passed to the host explicitly and reported as auto", async () => {
    const { sdk, openSession } = sdkFixture()
    const created = await sdk.create({ name: "fresh" })
    expect(created).toMatchObject({ kind: "ok", deduplicated: false })
    expect(openSession.mock.calls).toEqual([[{ cwd: process.cwd(), name: "fresh", provider: "anthropic", modelId: "claude-opus-5-5", thinkingLevel: "medium" }]])
    expect(threadOf(created).model).toEqual({ provider: "anthropic", id: "claude-opus-5-5", thinking_level: "medium", provenance: "auto", set_by: null, reason: null })
  })

  test("#given the profile names no connected model #when a session is created with no model #then the first connected model is chosen, never the host's own default", async () => {
    const { sdk, openSession } = sdkFixture({ catalog: [{ provider: "openai", id: "gpt-y", name: "GPT Y", thinking_levels: ["low", "high"] }] })
    const created = await sdk.create({})
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ provider: "openai", modelId: "gpt-y" })
    expect(threadOf(created).model).toMatchObject({ provider: "openai", id: "gpt-y", provenance: "auto", set_by: null })
  })

  test("#given only --provider #when a session is created #then auto picks within that provider, and a provider serving nothing is refused model_not_found before anything opens", async () => {
    const { sdk, openSession } = sdkFixture()
    const created = await sdk.create({ provider: "openai" })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ provider: "openai", modelId: "gpt-x" })
    expect(threadOf(created).model).toMatchObject({ provider: "openai", id: "gpt-x", provenance: "auto", set_by: null })
    expect(await sdk.create({ provider: "google" })).toMatchObject({ kind: "error", error: { code: "model_not_found", details: { available: ["anthropic/claude-opus-5-5", "openai/gpt-x", "openai/gpt-y"] } } })
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  test("#given an empty or whitespace-only --provider #when a session is created #then it counts as no provider: auto over every connected model, and a model is matched unscoped", async () => {
    const { sdk, openSession } = sdkFixture()
    expect(threadOf(await sdk.create({ provider: "" })).model).toMatchObject({ provider: "anthropic", id: "claude-opus-5-5", provenance: "auto" })
    expect(threadOf(await sdk.create({ provider: "  " })).model).toMatchObject({ provider: "anthropic", id: "claude-opus-5-5", provenance: "auto" })
    expect(threadOf(await sdk.create({ provider: " ", model: "gpt-y" })).model).toMatchObject({ provider: "openai", id: "gpt-y", provenance: "set" })
    expect(threadOf(await sdk.create({ provider: "", model: "openai/gpt-x" })).model).toMatchObject({ provider: "openai", id: "gpt-x", provenance: "set" })
    expect(openSession.mock.calls.map(([params]) => `${params.provider}/${params.modelId}`)).toEqual(["anthropic/claude-opus-5-5", "anthropic/claude-opus-5-5", "openai/gpt-y", "openai/gpt-x"])
  })

  test("#given a host that cannot list a new session's models #when a session is created with a provider, model or level #then it is refused unsupported and nothing opens, and with none of them it opens on the host's default", async () => {
    const { sdk, openSession } = sdkFixture({ listsCatalog: false })
    expect(await sdk.create({ provider: "openai" })).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(await sdk.create({ model: "gpt-x" })).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(await sdk.create({ thinking: "high" })).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(openSession).not.toHaveBeenCalled()
    expect(await sdk.create({ name: "plain", provider: " " })).toMatchObject({ kind: "ok", deduplicated: false })
    expect(openSession.mock.calls).toEqual([[{ cwd: process.cwd(), name: "plain" }]])
  })

  test("#given no provider is connected #when a session is created #then it is refused model_not_found with an empty list and nothing opens", async () => {
    const { sdk, openSession } = sdkFixture({ catalog: [] })
    expect(await sdk.create({ name: "nothing" })).toMatchObject({ kind: "error", error: { code: "model_not_found", details: { available: [] } } })
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe("#9425 spawn: an explicit choice wins", () => {
  test("#given --model with --set-by config #when created #then the host gets exactly that model and list/read report it as set by config", async () => {
    const { sdk, openSession } = sdkFixture()
    const created = await sdk.create({ name: "pinned", model: "gpt-x", set_by: "config" })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ provider: "openai", modelId: "gpt-x" })
    const expected = { provider: "openai", id: "gpt-x", thinking_level: "high", provenance: "set", set_by: "config", reason: null }
    expect(threadOf(created).model).toEqual(expected)
    const listed = await sdk.list({})
    expect((listed as unknown as { threads: { thread_id: string; model: unknown }[] }).threads.find((thread) => thread.thread_id === threadOf(created).thread_id)?.model).toEqual(expected)
    expect(await sdk.read({ thread: "pinned" })).toMatchObject({ kind: "ok", model: expected })
  })

  test("#given provider/id and a thinking level and no --set-by #when created #then it is set by the user at that level", async () => {
    const { sdk, openSession } = sdkFixture()
    const created = await sdk.create({ model: "openai/gpt-y", thinking: "xhigh" })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ provider: "openai", modelId: "gpt-y", thinkingLevel: "xhigh" })
    expect(threadOf(created).model).toEqual({ provider: "openai", id: "gpt-y", thinking_level: "xhigh", provenance: "set", set_by: "user", reason: null })
  })

  test("#given an unknown and an ambiguous model #when created #then model_not_found lists what is available, model_ambiguous lists candidates, and nothing opens", async () => {
    const { sdk, openSession } = sdkFixture()
    expect(await sdk.create({ model: "nope" })).toMatchObject({ kind: "error", error: { code: "model_not_found", details: { available: ["anthropic/claude-opus-5-5", "openai/gpt-x", "openai/gpt-y"] } } })
    expect(await sdk.create({ model: "gpt" })).toMatchObject({ kind: "error", error: { code: "model_ambiguous", details: { candidates: ["openai/gpt-x", "openai/gpt-y"] } } })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given a thinking level the chosen model cannot run #when created #then it is refused with the supported list and nothing opens", async () => {
    const { sdk, openSession } = sdkFixture()
    expect(await sdk.create({ model: "claude-opus-5-5", thinking: "xhigh" })).toMatchObject({ kind: "error", error: { code: "thinking_level_unsupported", details: { supported: ["off", "low", "medium", "high"] } } })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given an unknown --set-by or a --set-by without a model #when created #then it is invalid_arguments and nothing opens", async () => {
    const { sdk, openSession } = sdkFixture()
    expect(await sdk.create({ model: "gpt-x", set_by: "robot" as never })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(await sdk.create({ set_by: "config" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe("#9425 mid-session: set-model, set-reasoning, models", () => {
  test("#given a bound live session #when set-model runs #then the engine switches for its next turn and list/read report it as set, by whoever said so", async () => {
    const { sdk, setModel, models } = sdkFixture()
    expect(await sdk.setModel({ thread: "lane", model: "GPT Y" })).toEqual({ kind: "ok", thread_id: "dur-lane", model: { provider: "openai", id: "gpt-y", thinking_level: "medium", provenance: "set", set_by: "user", reason: null } })
    expect(setModel.mock.calls).toEqual([["rpc-1", "openai", "gpt-y"]])
    expect(models.get("rpc-1")).toEqual({ provider: "openai", id: "gpt-y" })
    expect(await sdk.setModel({ thread: "lane", model: "gpt-x", set_by: "lead" })).toMatchObject({ kind: "ok", model: { id: "gpt-x", provenance: "set", set_by: "lead" } })
    expect(await sdk.read({ thread: "lane" })).toMatchObject({ kind: "ok", model: { provider: "openai", id: "gpt-x", set_by: "lead" } })
    expect(await sdk.setModel({ thread: "lane", model: "gpt-y", provider: "  " })).toMatchObject({ kind: "ok", model: { provider: "openai", id: "gpt-y" } })
  })

  test("#given an unknown, ambiguous or empty model, or a thread with no live owner #when set-model runs #then each is refused with its code and the engine is not touched", async () => {
    const { sdk, setModel } = sdkFixture({ dead: ["dur-gone"] })
    expect(await sdk.setModel({ thread: "lane", model: "nope" })).toMatchObject({ kind: "error", error: { code: "model_not_found", details: { available: ["anthropic/claude-opus-5-5", "openai/gpt-x", "openai/gpt-y"] } } })
    expect(await sdk.setModel({ thread: "lane", model: "gpt" })).toMatchObject({ kind: "error", error: { code: "model_ambiguous", details: { candidates: ["openai/gpt-x", "openai/gpt-y"] } } })
    expect(await sdk.setModel({ thread: "lane", model: "  " })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(await sdk.setModel({ thread: "dur-gone", model: "gpt-x" })).toMatchObject({ kind: "error", error: { code: "not_resumable" } })
    expect(setModel).not.toHaveBeenCalled()
  })

  test("#given a level the active model cannot run #when set-reasoning runs at session scope #then it is refused with the supported list and nothing changes; a supported level is applied and reported", async () => {
    const { sdk, setThinkingLevel } = sdkFixture()
    expect(await sdk.setReasoning({ thread: "lane", level: "xhigh" })).toMatchObject({ kind: "error", error: { code: "thinking_level_unsupported", details: { supported: ["off", "low", "medium", "high"] } } })
    expect(setThinkingLevel).not.toHaveBeenCalled()
    await sdk.setModel({ thread: "lane", model: "claude-opus-5-5" })
    expect(await sdk.setReasoning({ thread: "lane", level: "low", scope: "turn" })).toEqual({ kind: "ok", thread_id: "dur-lane", level: "low", scope: "turn" })
    expect(setThinkingLevel.mock.calls).toEqual([["rpc-1", "low", "turn"]])
    expect(await sdk.read({ thread: "lane" })).toMatchObject({ kind: "ok", model: { id: "claude-opus-5-5", thinking_level: "low" } })
  })

  test("#given a bad scope or level #when set-reasoning runs #then it is invalid_arguments", async () => {
    const { sdk, setThinkingLevel } = sdkFixture()
    expect(await sdk.setReasoning({ thread: "lane", level: "high", scope: "forever" as never })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(await sdk.setReasoning({ thread: "lane", level: "loud" as never })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(setThinkingLevel).not.toHaveBeenCalled()
  })

  test("#given no thread #when models runs #then it lists what a new session could use from connected providers, narrowed by --provider", async () => {
    const { sdk } = sdkFixture()
    expect(await sdk.models({})).toEqual({ kind: "ok", thread_id: null, current: null, available: CATALOG.map((entry) => ({ ...entry })) })
    expect(await sdk.models({ provider: "anthropic" })).toMatchObject({ kind: "ok", available: [{ provider: "anthropic", id: "claude-opus-5-5" }] })
    expect(await sdk.models({ provider: " " })).toEqual({ kind: "ok", thread_id: null, current: null, available: CATALOG.map((entry) => ({ ...entry })) })
  })

  test("#given a thread created through the gateway #when models runs for it #then current is its recorded model", async () => {
    const { sdk } = sdkFixture()
    const created = await sdk.create({ name: "with-model", model: "gpt-x" })
    expect(await sdk.models({ thread: "with-model" })).toMatchObject({ kind: "ok", thread_id: threadOf(created).thread_id, current: { provider: "openai", id: "gpt-x", provenance: "set", set_by: "user" } })
  })
})

describe("#9425 resume keeps the explicit choice", () => {
  test("#given a session created with a set model #when its host restarts and reopens it under a new routing id #then list still reports the same set model and who set it", async () => {
    const { sdk, reopen } = sdkFixture()
    const created = await sdk.create({ name: "sticky", model: "gpt-x", set_by: "config" })
    reopen(threadOf(created).thread_id)
    const listed = (await sdk.list({})) as unknown as { threads: { thread_id: string; sessionId: string; model: unknown }[] }
    const row = listed.threads.find((thread) => thread.thread_id === threadOf(created).thread_id)
    expect(row?.sessionId).not.toBe((threadOf(created) as unknown as { sessionId: string }).sessionId)
    expect(row?.model).toEqual({ provider: "openai", id: "gpt-x", thinking_level: "high", provenance: "set", set_by: "config", reason: null })
  })
})

describe("#9425 agent tool thread_create", () => {
  test("#given a lead session passing a model #when thread_create runs #then the host gets it explicitly and the model is set by the lead", async () => {
    const fake = fakeHost()
    const agentDir = scratch("thread-9425-tool-")
    const store = createGatewayStore({ agentDir })
    disposables.push(store)
    const tools = createThreadTools({ host: fake.host, store, stateDirectory: agentDir, callerSessionId: () => "dur-lead", callerWorkspaceRoot: () => process.cwd(), modelProfile: () => ({ active: "recommended" }) })
    const create = tools.find((tool) => tool.name === "thread_create")
    const output = await create?.execute("call-1", { name: "child", model: "gpt-y", thinking: "low" }, undefined, undefined, undefined as never)
    const result = (output as { details: { result: unknown } }).details.result
    expect(fake.openSession.mock.calls[0]?.[0]).toMatchObject({ provider: "openai", modelId: "gpt-y", thinkingLevel: "low" })
    expect(result).toMatchObject({ kind: "ok", thread: { model: { provider: "openai", id: "gpt-y", thinking_level: "low", provenance: "set", set_by: "lead", reason: null } } })
  })
})

/**
 * #9425 set-reasoning through the agent tool, which leaves an unsupported session-scope level to the
 * engine: the result and the record name the level the session runs after the change, which is the
 * engine's clamp of the request when the model cannot run it, never the request itself.
 */
function toolFixture() {
  const fake = fakeHost()
  const agentDir = scratch("thread-9425-reasoning-")
  const store = createGatewayStore({ agentDir })
  disposables.push(store)
  const tools = createThreadTools({ host: fake.host, store, stateDirectory: agentDir, callerSessionId: () => "dur-lead", callerWorkspaceRoot: () => process.cwd(), modelProfile: () => ({ active: "recommended" }) })
  let calls = 0
  const run = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return ((await tool.execute(`call-${++calls}`, args, undefined, undefined, undefined as never)) as { details: { result: unknown } }).details.result
  }
  const engineLevel = async () => ((await fake.host.getState("rpc-1")) as { thinkingLevel?: string }).thinkingLevel
  const recordedLevel = async () => (await store.sessionModels(["dur-lane"]))["dur-lane"]?.thinking_level
  return { run, engineLevel, recordedLevel }
}

describe("#9425 set-reasoning records the level the engine runs", () => {
  test("#given a model that runs at most high and is already at high #when the agent tool asks for xhigh #then the engine stays at high and the result and the record both say high", async () => {
    const f = toolFixture()
    expect(await f.run("thread_set_model", { thread: "lane", model: "claude-opus-5-5" })).toMatchObject({ kind: "ok" })
    expect(await f.run("thread_set_reasoning", { thread: "lane", level: "high" })).toEqual({ kind: "ok", thread_id: "dur-lane", level: "high", scope: "session" })
    expect(await f.run("thread_set_reasoning", { thread: "lane", level: "xhigh" })).toEqual({ kind: "ok", thread_id: "dur-lane", level: "high", scope: "session" })
    expect(await f.engineLevel()).toBe("high")
    expect(await f.recordedLevel()).toBe("high")
  })

  test("#given a session at medium #when the agent tool asks for xhigh and then low #then each change lands, the clamped one is reported and recorded at the level the engine chose, the supported one as asked", async () => {
    const f = toolFixture()
    await f.run("thread_set_model", { thread: "lane", model: "claude-opus-5-5" })
    expect(await f.recordedLevel()).toBe("medium")
    const clamped = (await f.run("thread_set_reasoning", { thread: "lane", level: "xhigh" })) as { level: string }
    expect<string | undefined>(clamped.level).toBe(await f.engineLevel())
    expect(clamped.level).not.toBe("xhigh")
    expect(await f.recordedLevel()).toBe(clamped.level)
    expect(await f.run("thread_set_reasoning", { thread: "lane", level: "low" })).toEqual({ kind: "ok", thread_id: "dur-lane", level: "low", scope: "session" })
    expect(await f.engineLevel()).toBe("low")
    expect(await f.recordedLevel()).toBe("low")
  })

  test("#given a turn-scope level the model cannot run #when the agent tool asks for it #then it is refused with the supported list and neither the engine nor the record changes", async () => {
    const f = toolFixture()
    await f.run("thread_set_model", { thread: "lane", model: "claude-opus-5-5" })
    expect(await f.run("thread_set_reasoning", { thread: "lane", level: "xhigh", scope: "turn" })).toMatchObject({ kind: "error", error: { code: "thinking_level_unsupported", details: { supported: ["off", "low", "medium", "high"] } } })
    expect(await f.engineLevel()).toBe("medium")
    expect(await f.recordedLevel()).toBe("medium")
  })
})

/** A component over a real store; the store's `model_observed` event is the signal a model_select write landed. */
function componentFixture() {
  const agentDir = scratch("thread-9425-component-")
  const store = createGatewayStore({ agentDir })
  disposables.push(store)
  const handlers = new Map<string, Array<(payload: unknown, ctx?: unknown) => unknown>>()
  const pi = { cwd: process.cwd(), registerTool() {}, on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {}, getThinkingLevel: () => "high" }
  createThreadComponent({ host: fakeHost().host, stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(pi as never, { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } } as never)
  const ctx = (durableId: string) => ({ sessionManager: { getSessionId: () => durableId } })
  const dispatch = async (event: string, durableId: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx(durableId))
  }
  const observed = (durableId: string) => new Promise<GatewayStoreEvent>((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`no model_observed for ${durableId} within 10 s`)) }, 10_000)
    const stop = store.onEvent((event) => {
      if (event.kind !== "model_observed" || event.session_durable_id !== durableId) return
      clearTimeout(timer)
      stop()
      resolve(event)
    })
  })
  const bindMilestones = async (durableId: string) => {
    const bound = await store.bind({ now: Date.now(), receipt: null, binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: `t-${durableId}`, root_message_id: null, progress_message_id: null, session_durable_id: durableId, direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["milestone", "completion"], policy_id: "default", ttl_seconds: null } })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    return bound.binding.binding_id
  }
  const rows = async (bindingId: string) => {
    const page = await store.readOutbox({ now: Date.now(), binding_id: bindingId })
    return page.kind === "ok" ? page.rows : []
  }
  const modelOf = async (durableId: string) => (await store.sessionModels([durableId]))[durableId] ?? null
  return { store, dispatch, observed, bindMilestones, rows, modelOf }
}

const CLAUDE = { provider: "anthropic", id: "claude-opus-5-5" }
const GPT_Y = { provider: "openai", id: "gpt-y" }

describe("#9425 runtime fallback is visible", () => {
  test("#given a gateway session with a set model and a milestone binding #when the engine falls back after a provider error #then ONE milestone row carries the switch and its reason, and the model reads fallback with the original setter kept", async () => {
    const f = componentFixture()
    await f.store.recordSessionModel({ now: Date.now(), durable_id: "dur-fb", model: { provider: "anthropic", id: "claude-opus-5-5", thinking_level: "high", provenance: "set", set_by: "config", reason: null } })
    const bindingId = await f.bindMilestones("dur-fb")
    await f.dispatch("message_end", "dur-fb", { message: { role: "assistant", content: [], stopReason: "error", errorMessage: "429 rate_limit_error: quota exhausted" } })
    const landed = f.observed("dur-fb")
    await f.dispatch("model_select", "dur-fb", { model: GPT_Y, previousModel: CLAUDE, source: "fallback" })
    await landed
    const written = await f.rows(bindingId)
    expect(written.map((row) => ({ event: row.event, text: row.text, model_change: row.model_change }))).toEqual([
      { event: "milestone", text: "switched to openai/gpt-y after a provider error on anthropic/claude-opus-5-5", model_change: { from: CLAUDE, to: GPT_Y, reason: "429 rate_limit_error: quota exhausted" } },
    ])
    expect(await f.modelOf("dur-fb")).toEqual({ provider: "openai", id: "gpt-y", thinking_level: "high", provenance: "fallback", set_by: "config", reason: "429 rate_limit_error: quota exhausted" })
  })

  test("#given a session on its fallback model #when the engine reverts to the chosen model #then the model reads its original provenance again and no second milestone is written", async () => {
    const f = componentFixture()
    await f.store.recordSessionModel({ now: Date.now(), durable_id: "dur-rv", model: { provider: "anthropic", id: "claude-opus-5-5", thinking_level: "high", provenance: "auto", set_by: null, reason: null } })
    const bindingId = await f.bindMilestones("dur-rv")
    const fell = f.observed("dur-rv")
    await f.dispatch("model_select", "dur-rv", { model: GPT_Y, previousModel: CLAUDE, source: "fallback" })
    await fell
    const reverted = f.observed("dur-rv")
    await f.dispatch("model_select", "dur-rv", { model: CLAUDE, previousModel: GPT_Y, source: "fallback-revert" })
    await reverted
    expect(await f.modelOf("dur-rv")).toEqual({ provider: "anthropic", id: "claude-opus-5-5", thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    expect((await f.rows(bindingId)).map((row) => row.event)).toEqual(["milestone"])
  })

  test("#given a gateway session #when the user switches with /model and later the session resumes #then the switch is set by the user and the resume's restore changes nothing", async () => {
    const f = componentFixture()
    await f.store.recordSessionModel({ now: Date.now(), durable_id: "dur-user", model: { provider: "anthropic", id: "claude-opus-5-5", thinking_level: "high", provenance: "auto", set_by: null, reason: null } })
    const switched = f.observed("dur-user")
    await f.dispatch("model_select", "dur-user", { model: GPT_Y, previousModel: CLAUDE, source: "set" })
    await switched
    await f.dispatch("model_select", "dur-user", { model: CLAUDE, previousModel: GPT_Y, source: "restore" })
    expect(await f.modelOf("dur-user")).toEqual({ provider: "openai", id: "gpt-y", thinking_level: "high", provenance: "set", set_by: "user", reason: null })
  })

  test("#given a gateway set-model by the config #when the session's own model_select lands after the store write #then the setter stays config", async () => {
    const f = componentFixture()
    await f.store.recordSessionModel({ now: Date.now(), durable_id: "dur-cfg", model: { provider: "openai", id: "gpt-y", thinking_level: "high", provenance: "set", set_by: "config", reason: null } })
    const landed = f.observed("dur-cfg")
    await f.dispatch("model_select", "dur-cfg", { model: GPT_Y, previousModel: CLAUDE, source: "set" })
    await landed
    expect(await f.modelOf("dur-cfg")).toMatchObject({ provenance: "set", set_by: "config" })
  })
})

import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createThreadComponent } from "./component"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createEngineSession, engineHost, type EngineModel as HarnessModel } from "./gateway/testing/engine-session"
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
    getState: async (sessionId) => ({ isStreaming: false, model: models.get(sessionId), thinkingLevel: thinking.get(sessionId) }),
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
  const readEngine = fake.host.getState
  /** The level the fake engine runs, read past any read-back a test holds. */
  const engineLevel = async () => ((await readEngine("rpc-1")) as { thinkingLevel?: string }).thinkingLevel ?? null
  return { ...fake, sdk, store, agentDir, engineLevel }
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

type EngineModel = { readonly provider: string; readonly id: string; readonly defaultThinkingLevel?: string }
type EngineSwitchOptions = Record<string, unknown>
type EngineSession = {
  readonly model: EngineModel | undefined
  readonly thinkingLevel: string
  _switchActiveModel(model: EngineModel, options: EngineSwitchOptions): Promise<unknown>
}

const CLAUDE = { provider: "anthropic", id: "claude-opus-5-5" }
const GPT_Y = { provider: "openai", id: "gpt-y" }
const CLAUDE_MODEL: EngineModel = { ...CLAUDE, defaultThinkingLevel: "high" }
const GPT_Y_MODEL: EngineModel = { ...GPT_Y, defaultThinkingLevel: "xhigh" }
const ENGINE_LEVELS: Readonly<Record<string, readonly string[]>> = { "anthropic/claude-opus-5-5": ["off", "low", "medium", "high"], "openai/gpt-y": ["off", "low", "medium", "high", "xhigh"] }

/**
 * A gateway session as the pinned engine runs it: its own model switch (AgentSession._switchActiveModel,
 * _emitModelSelect, _setThinkingLevel, _applyEphemeralThinkingLevel) over a real in-memory session, with the
 * component's handlers called the way the extension runner calls them and a real gateway store. The services
 * the switch consults but this behavior does not depend on are doubles. `admission` makes the engine
 * hold the candidate (its context-budget deferral) or refuse it (its usability check) AFTER the model_select
 * hook ran, which is where a switch is decided. The switches mirror the engine's callers: setModel for /model
 * and the gateway's set-model, the retry fallback for fallback and fallback-revert.
 */
function engineFixture() {
  const agentDir = scratch("thread-9425-engine-")
  const store = createGatewayStore({ agentDir })
  disposables.push(store)
  const handlers = new Map<string, Array<(payload: unknown, ctx?: unknown) => unknown>>()
  const engine = Object.create(AgentSession.prototype) as EngineSession
  const sessionManager = SessionManager.inMemory(process.cwd())
  const durableId = sessionManager.getSessionId()
  const admission = { hold: false, refuse: false }
  const ctx = { get model() { return engine.model }, sessionManager }
  const deliver = async (event: { readonly type: string }) => {
    for (const handler of handlers.get(event.type) ?? []) await handler(event, ctx)
  }
  Object.assign(engine, {
    agent: { state: { model: CLAUDE_MODEL, thinkingLevel: "high", thinkingSelection: undefined, reasoningBaseline: undefined, systemPrompt: "base", messages: [] }, abortServerSideFallback: false },
    sessionManager,
    _scopedModels: [],
    _currentServiceTier: undefined,
    _baseSystemPromptOptions: {},
    _shownHighReasoningWarningKeys: new Set<string>(),
    _extensionRunner: { emitModelSelect: async (event: { readonly type: string }) => { await deliver(event); return undefined }, emit: deliver },
    settingsManager: { getAbortServerSideFallback: () => false, setDefaultModelAndProvider() {}, setModelThinkingLevel() {}, setDefaultThinkingLevel() {} },
    _retryFallback: { hasConfiguredChain: () => false, noteManualThinkingLevel() {} },
    _emit() {},
    syncPromptCacheSafeWaitEnv() {},
    _modelSelectionChangesContext: () => true,
    _invalidateCompactionForModelSelection() {},
    _getDownswitchLiveContextTokens: () => 0,
    _getThinkingForModelSwitch: (model: EngineModel, explicit?: string) => ({ level: explicit ?? model.defaultThinkingLevel ?? "medium", selection: undefined }),
    isFastModeActive: () => false,
    _resolveServiceTier: () => undefined,
    _emitHighReasoningWarningIfNeeded() {},
    _emitServiceTierChangeIfNeeded() {},
    getAvailableThinkingLevels: () => ENGINE_LEVELS[`${engine.model?.provider}/${engine.model?.id}`] ?? ["off"],
    _projectSwitchDeferral: () => (admission.hold ? { requiredTokens: 200_000, contextWindow: 100_000 } : undefined),
    _admitSwitchCompactionRequired() {},
    _reduceForSwitchTarget: (_model: EngineModel, tokens: number) => tokens,
    _assertModelUsableForSwitch: () => { if (admission.refuse) throw new Error("the live context does not fit the candidate model") },
  })
  const pi = { cwd: process.cwd(), registerTool() {}, on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) }, registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {}, getThinkingLevel: () => engine.thinkingLevel }
  createThreadComponent({ host: fakeHost().host, stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store }).register(pi as never, { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } } as never)
  const userSwitch = (model: EngineModel) => engine._switchActiveModel(model, { persistDefault: false, appendSessionEntry: true, emitModelSelect: true, modelSelectSource: "set", invalidateCompaction: true })
  // The retry fallback passes the fallback chain entry's thinking level along with the model.
  const runtimeSwitch = (model: EngineModel, source: "fallback" | "fallback-revert", thinking = "high") => engine._switchActiveModel(model, { persistDefault: false, appendSessionEntry: true, entryReason: source, emitModelSelect: true, modelSelectSource: source, invalidateCompaction: true, ephemeralThinkingLevel: thinking, allowDeferral: false, repairWithSlice: true })
  const providerError = (text: string) => deliver({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: text } } as { readonly type: string })
  /** The session settles: the point by which every switch it started has been applied, held or refused. */
  const settle = () => deliver({ type: "agent_settled" })
  /** Resolves on the store's next `count` model_observed events for this session; subscribe before the switch. */
  const observed = (count = 1) => new Promise<void>((resolve, reject) => {
    let seen = 0
    const timer = setTimeout(() => { stop(); reject(new Error(`saw ${seen} of ${count} model_observed events within 10 s`)) }, 10_000)
    const stop = store.onEvent((event) => {
      if (event.kind !== "model_observed" || event.session_durable_id !== durableId || ++seen < count) return
      clearTimeout(timer)
      stop()
      resolve()
    })
  })
  const bindMilestones = async () => {
    const bound = await store.bind({ now: Date.now(), receipt: null, binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: `t-${durableId}`, root_message_id: null, progress_message_id: null, session_durable_id: durableId, direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["milestone", "completion"], policy_id: "default", ttl_seconds: null } })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    return bound.binding.binding_id
  }
  // Store operations run in order on its one worker, so a read issued after a step sees every write that step issued.
  const rows = async (bindingId: string) => {
    const page = await store.readOutbox({ now: Date.now(), binding_id: bindingId })
    return page.kind === "ok" ? page.rows : []
  }
  const recorded = async () => (await store.sessionModels([durableId]))[durableId] ?? null
  const record = (model: GatewayStoreModel) => store.recordSessionModel({ now: Date.now(), durable_id: durableId, model })
  /**
   * The thread SDK over this session's own store, as a connector's `omo thread` runs beside the live
   * session: its host drives this engine's switch and answers get_state from it. `beforeStateReply`
   * holds the first get_state after the next set_model until `wait` resolves, after computing the answer.
   */
  const sharedSdk = () => {
    const session: ThreadHostSession = { sessionId: "rpc-e", durableSessionId: durableId, cwd: process.cwd(), name: "lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
    let hold: { readonly wait: () => Promise<void>; armed: boolean } | undefined
    const host: ThreadHost = {
      socket: "/tmp/thread-9429-shared.sock",
      listSessions: async () => [session],
      listView: async () => ({ sessions: [session], hosts: [{ socket: HOST_SOCKET, list_sessions: { sessions: [session] }, endpoint_kind: "rpc_host", alive: true }], disk: [] }),
      openSession: async () => { throw new Error("this session is already open") },
      availableModels: async () => CATALOG,
      getMessages: async () => [],
      getState: async () => {
        const answer = { isStreaming: false, model: engine.model === undefined ? null : { provider: engine.model.provider, id: engine.model.id }, thinkingLevel: engine.thinkingLevel }
        const pending = hold
        if (pending?.armed === true) {
          hold = undefined
          await pending.wait()
        }
        return answer
      },
      prompt: async () => ({}),
      interrupt: async () => ({ interrupted: false }),
      setSessionName: async () => {},
      setModel: async (_sessionId: string, provider: string, id: string) => {
        await userSwitch(provider === GPT_Y.provider && id === GPT_Y.id ? GPT_Y_MODEL : CLAUDE_MODEL)
        if (hold !== undefined) hold.armed = true
        // The pinned engine's set_model reply echoes the requested model (connection-handler.js:883-884).
        return { provider, id }
      },
      getAvailableModels: async () => CATALOG,
      setThinkingLevel: async () => {},
      getAvailableThinkingLevels: async () => ENGINE_LEVELS[`${engine.model?.provider}/${engine.model?.id}`] ?? ["off"],
    }
    const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host, store, modelProfile: () => ({ model_profile: "recommended" }) })
    disposables.push(sdk)
    return { sdk, beforeStateReply: (wait: () => Promise<void>) => { hold = { wait, armed: false } } }
  }
  return { engine, admission, userSwitch, runtimeSwitch, providerError, settle, observed, bindMilestones, rows, recorded, record, sharedSdk }
}

type GatewayStoreModel = Parameters<GatewayStore["recordSessionModel"]>[0]["model"]

describe("#9425 runtime fallback is visible", () => {
  test("#given a gateway session with a set model and a milestone binding #when the engine falls back after a provider error #then ONE milestone row carries the switch and its reason, and the model reads fallback with the original setter kept", async () => {
    const f = engineFixture()
    await f.record({ ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "config", reason: null })
    const bindingId = await f.bindMilestones()
    await f.providerError("429 rate_limit_error: quota exhausted")
    const landed = f.observed()
    await f.runtimeSwitch(GPT_Y_MODEL, "fallback")
    await f.settle()
    await landed
    const written = await f.rows(bindingId)
    expect(written.map((row) => ({ event: row.event, model_change: row.model_change }))).toEqual([{ event: "milestone", model_change: { from: CLAUDE, to: GPT_Y, reason: "429 rate_limit_error: quota exhausted" } }])
    expect(written[0]?.text).toContain("openai/gpt-y")
    expect(await f.recorded()).toEqual({ ...GPT_Y, thinking_level: "high", provenance: "fallback", set_by: "config", reason: "429 rate_limit_error: quota exhausted" })
  })

  test("#given a session on its fallback model #when the engine reverts to the chosen model #then the model reads its original provenance again and no second milestone is written", async () => {
    const f = engineFixture()
    await f.record({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    const bindingId = await f.bindMilestones()
    const both = f.observed(2)
    await f.runtimeSwitch(GPT_Y_MODEL, "fallback")
    await f.runtimeSwitch(CLAUDE_MODEL, "fallback-revert")
    await f.settle()
    await both
    expect(await f.recorded()).toEqual({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    expect((await f.rows(bindingId)).map((row) => row.event)).toEqual(["milestone"])
  })

  test("#given a gateway session #when the user switches with /model #then the switch is set by the user at the level the engine applied for that model", async () => {
    const f = engineFixture()
    await f.record({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    const landed = f.observed()
    await f.userSwitch(GPT_Y_MODEL)
    await f.settle()
    await landed
    expect(f.engine.thinkingLevel).toBe("xhigh")
    expect(await f.recorded()).toEqual({ ...GPT_Y, thinking_level: "xhigh", provenance: "set", set_by: "user", reason: null })
  })

  test("#given a gateway set-model by the config #when the session's own switch to that model lands #then the setter stays config", async () => {
    const f = engineFixture()
    await f.record({ ...GPT_Y, thinking_level: "high", provenance: "set", set_by: "config", reason: null })
    const landed = f.observed()
    await f.userSwitch(GPT_Y_MODEL)
    await f.settle()
    await landed
    expect(await f.recorded()).toMatchObject({ ...GPT_Y, provenance: "set", set_by: "config" })
  })
})

describe("#9425 a switch the engine does not apply leaves the record and the outbox alone", () => {
  test("#given a fallback the engine refuses after the model_select hook #when the session settles #then the engine is still on the chosen model, the record still names it, and no milestone announces a switch", async () => {
    const f = engineFixture()
    const chosen: GatewayStoreModel = { ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "config", reason: null }
    await f.record(chosen)
    const bindingId = await f.bindMilestones()
    await f.providerError("529 overloaded_error")
    f.admission.refuse = true
    await expect(f.runtimeSwitch(GPT_Y_MODEL, "fallback")).rejects.toThrow("does not fit")
    await f.settle()
    expect(f.engine.model).toMatchObject(CLAUDE)
    expect(await f.recorded()).toEqual(chosen)
    expect(await f.rows(bindingId)).toEqual([])
  })

  test("#given a /model switch the engine holds for compaction #when the session settles #then the record keeps the model and level the session still runs", async () => {
    const f = engineFixture()
    const before: GatewayStoreModel = { ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null }
    await f.record(before)
    f.admission.hold = true
    await f.userSwitch(GPT_Y_MODEL)
    await f.settle()
    expect(f.engine.model).toMatchObject(CLAUDE)
    expect(f.engine.thinkingLevel).toBe("high")
    expect(await f.recorded()).toEqual(before)
  })

  test("#given a session on its fallback model #when the engine refuses the revert #then the record still reads the fallback it runs and the one milestone stays the only one", async () => {
    const f = engineFixture()
    await f.record({ ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "user", reason: null })
    const bindingId = await f.bindMilestones()
    await f.providerError("429 rate_limit_error")
    const fell = f.observed()
    await f.runtimeSwitch(GPT_Y_MODEL, "fallback")
    await f.settle()
    await fell
    f.admission.refuse = true
    await expect(f.runtimeSwitch(CLAUDE_MODEL, "fallback-revert")).rejects.toThrow("does not fit")
    await f.settle()
    expect(f.engine.model).toMatchObject(GPT_Y)
    expect(await f.recorded()).toEqual({ ...GPT_Y, thinking_level: "high", provenance: "fallback", set_by: "user", reason: "429 rate_limit_error" })
    expect((await f.rows(bindingId)).map((row) => row.event)).toEqual(["milestone"])
  })

  test("#given a refused fallback #when a later fallback is applied #then only the applied switch is recorded and announced", async () => {
    const f = engineFixture()
    await f.record({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    const bindingId = await f.bindMilestones()
    f.admission.refuse = true
    await expect(f.runtimeSwitch({ provider: "openai", id: "gpt-x" }, "fallback")).rejects.toThrow("does not fit")
    f.admission.refuse = false
    const landed = f.observed()
    await f.runtimeSwitch(GPT_Y_MODEL, "fallback")
    await f.settle()
    await landed
    expect((await f.rows(bindingId)).map((row) => row.model_change)).toEqual([{ from: CLAUDE, to: GPT_Y, reason: null }])
    expect(await f.recorded()).toMatchObject({ ...GPT_Y, provenance: "fallback" })
  })
})

/**
 * Holds the first state read-back a model command makes after it changed the engine (the first
 * get_state after a set_model or set_thinking_level issued once this is installed), until `release`.
 * `at-request` computes that answer when the request arrives and delivers it late, as a reply in flight
 * while another call switches the engine; `at-reply` computes it on delivery.
 */
function holdFirstReadBack(f: ReturnType<typeof sdkFixture>, answer: "at-request" | "at-reply") {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const changes = () => f.setModel.mock.calls.length + f.setThinkingLevel.mock.calls.length
  const baseline = changes()
  let held = false
  const originalGetState = f.host.getState
  const snapshot = async (sessionId: string) => ({ ...((await originalGetState(sessionId)) as object), model: f.models.get(sessionId) })
  Object.assign(f.host, {
    getState: async (sessionId: string) => {
      if (held || changes() === baseline) return await snapshot(sessionId)
      held = true
      const early = answer === "at-request" ? await snapshot(sessionId) : undefined
      entered.resolve()
      await released.promise
      return early ?? (await snapshot(sessionId))
    },
  })
  return { entered: entered.promise, release: () => released.resolve() }
}

describe("#9425 a held or out-of-order set-model never lies about what the engine runs", () => {
  test("#given a set-model the engine holds for compaction #when the SDK call returns #then the result names the requested model as pending until the hold applies", async () => {
    const f = sdkFixture()
    const e = engineFixture()
    await f.sdk.setModel({ thread: "lane", model: "the model" })
    Object.assign(f.host, {
      setModel: async (_sessionId: string, provider: string, id: string) => {
        await e.userSwitch({ provider, id, defaultThinkingLevel: "xhigh" })
        // The pinned engine's exact set_model RPC contract (connection-handler.js:883-884): the reply echoes the requested model.
        return { provider, id }
      },
      getState: async () => ({ model: e.engine.model, thinkingLevel: e.engine.thinkingLevel }),
    })
    e.admission.hold = true
    const result = await f.sdk.setModel({ thread: "lane", model: "gpt-y" })
    await e.settle()
    const stored = (await f.store.sessionModels(["dur-lane"]))["dur-lane"]
    const engineId = e.engine.model?.id
    const engineProvider = e.engine.model?.provider
    if (engineId === undefined || engineProvider === undefined) throw new Error("engine held no model")
    expect(engineId).toBe(CLAUDE.id)
    expect(engineProvider).toBe(CLAUDE.provider)
    expect(stored?.id).toBe(engineId)
    expect(stored?.provider).toBe(engineProvider)
    // The ok result reports the model the engine still runs and marks the requested one pending:
    // the caller learns its switch is held, never that it applied.
    expect(result).toMatchObject({ kind: "ok", model: { provider: CLAUDE.provider, id: CLAUDE.id }, pending: { provider: GPT_Y.provider, id: GPT_Y.id } })
  })

  test("#given a set-model the engine applies at once #when the SDK call returns #then the result carries no pending field", async () => {
    const f = sdkFixture()
    const result = await f.sdk.setModel({ thread: "lane", model: "gpt-y" })
    expect(result).toMatchObject({ kind: "ok", model: { provider: "openai", id: "gpt-y" } })
    expect("pending" in result).toBe(false)
  })

  test("#given two set-model calls whose first completes last #when both finish #then the store still names the later applied model, and the earlier call reports its switch superseded", async () => {
    const f = sdkFixture()
    const gate = holdFirstReadBack(f, "at-reply")
    const first = f.sdk.setModel({ thread: "lane", model: "gpt-x", set_by: "config" })
    await gate.entered
    const second = await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "user" })
    gate.release()
    const earlier = await first
    const stored = (await f.store.sessionModels(["dur-lane"]))["dur-lane"]
    expect(f.models.get("rpc-1")).toEqual({ provider: "openai", id: "gpt-y" })
    expect(second).toMatchObject({ kind: "ok", model: { id: "gpt-y", set_by: "user" } })
    // The earlier switch applied and was replaced: it will not apply again, so it is not pending.
    expect(earlier).toMatchObject({ kind: "ok", model: { id: "gpt-y", set_by: "user" }, superseded: { provider: "openai", id: "gpt-x" } })
    expect("pending" in earlier).toBe(false)
    expect(stored).toMatchObject({ id: "gpt-y", set_by: "user" })
  })

  test("#given a set-model whose read-back is answered from before a later call switched back to the recorded model #when both finish #then the record names the model the engine runs", async () => {
    const f = sdkFixture()
    await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "user" })
    const gate = holdFirstReadBack(f, "at-request")
    const first = f.sdk.setModel({ thread: "lane", model: "gpt-x", set_by: "config" })
    await gate.entered
    expect(await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })).toMatchObject({ kind: "ok", model: { id: "gpt-y", set_by: "lead" } })
    gate.release()
    expect(await first).toMatchObject({ kind: "ok", model: { id: "gpt-y" }, superseded: { provider: "openai", id: "gpt-x" } })
    expect(f.models.get("rpc-1")).toEqual({ provider: "openai", id: "gpt-y" })
    expect((await f.store.sessionModels(["dur-lane"]))["dur-lane"]).toMatchObject({ provider: "openai", id: "gpt-y", provenance: "set", set_by: "lead" })
  })

  test("#given a session with no record whose engine switches with no writer between a set-model's stale read-back and its write #when the call finishes #then it reads the engine again and the record names the model it runs", async () => {
    const f = sdkFixture()
    expect(await f.store.sessionModels(["dur-lane"])).toEqual({})
    const gate = holdFirstReadBack(f, "at-request")
    const first = f.sdk.setModel({ thread: "lane", model: "gpt-x", set_by: "config" })
    await gate.entered
    // A /model in a session the gateway has no record of: its observer writes nothing to fence the stale answer.
    f.models.set("rpc-1", { provider: "openai", id: "gpt-y" })
    gate.release()
    expect(await first).toMatchObject({ kind: "ok", model: { provider: "openai", id: "gpt-y", set_by: "user" }, superseded: { provider: "openai", id: "gpt-x" } })
    expect((await f.store.sessionModels(["dur-lane"]))["dur-lane"]).toMatchObject({ provider: "openai", id: "gpt-y" })
  })

  test("#given a session with no record whose level changes between a set-model's stale read-back and its write #when the call finishes #then the record names the level the engine runs", async () => {
    const f = sdkFixture()
    const gate = holdFirstReadBack(f, "at-request")
    const first = f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "config" })
    await gate.entered
    // set-reasoning on a session with no record writes nothing, so nothing fences the stale answer.
    expect(await f.sdk.setReasoning({ thread: "lane", level: "high" })).toMatchObject({ kind: "ok", level: "high" })
    gate.release()
    expect(await first).toMatchObject({ kind: "ok", model: { provider: "openai", id: "gpt-y", set_by: "config" } })
    expect(await f.engineLevel()).toBe("high")
    expect((await f.store.sessionModels(["dur-lane"]))["dur-lane"]).toMatchObject({ provider: "openai", id: "gpt-y", thinking_level: "high", set_by: "config" })
  })

  test("#given a host whose state names no model #when set-model runs #then it is refused unsupported and the engine is not touched", async () => {
    const f = sdkFixture()
    const originalGetState = f.host.getState
    Object.assign(f.host, { getState: async (sessionId: string) => ({ ...((await originalGetState(sessionId)) as object), model: undefined }) })
    expect(await f.sdk.setModel({ thread: "lane", model: "gpt-y" })).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(f.setModel).not.toHaveBeenCalled()
    expect(await f.store.sessionModels(["dur-lane"])).toEqual({})
  })

  test("#given a set-reasoning completing after a later set-model switched the model #when both finish #then the record keeps the newer model, not the read-back from before the switch", async () => {
    const f = sdkFixture()
    const gate = holdFirstReadBack(f, "at-reply")
    const first = f.sdk.setReasoning({ thread: "lane", level: "high" })
    await gate.entered
    const second = await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "user" })
    gate.release()
    const earlier = await first
    const stored = (await f.store.sessionModels(["dur-lane"]))["dur-lane"]
    expect(f.models.get("rpc-1")).toEqual({ provider: "openai", id: "gpt-y" })
    expect(earlier).toMatchObject({ kind: "ok", level: "high" })
    expect(second).toMatchObject({ kind: "ok", model: { id: "gpt-y" } })
    expect(stored?.id).toBe("gpt-y")
    expect(stored?.set_by).toBe("user")
    expect(stored?.thinking_level).toBe("high")
  })

  test("#given two set-reasoning calls whose first state read is answered from before the second applied #when both finish #then the record names the level the engine runs", async () => {
    const f = sdkFixture()
    await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "user" })
    const gate = holdFirstReadBack(f, "at-request")
    const first = f.sdk.setReasoning({ thread: "lane", level: "high" })
    await gate.entered
    const second = await f.sdk.setReasoning({ thread: "lane", level: "low" })
    gate.release()
    const earlier = await first
    const engineLevel = await f.engineLevel()
    const stored = (await f.store.sessionModels(["dur-lane"]))["dur-lane"]
    expect(engineLevel).toBe("low")
    expect(earlier).toMatchObject({ kind: "ok" })
    expect(second).toMatchObject({ kind: "ok", level: "low" })
    expect(stored?.id).toBe("gpt-y")
    expect(stored?.thinking_level).toBe(engineLevel)
  })

  test("#given a set-reasoning whose read-back is answered from before a later call set the recorded level again #when both finish #then the record names the level the engine runs", async () => {
    const f = sdkFixture()
    await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "user" })
    const recorded = (await f.store.sessionModels(["dur-lane"]))["dur-lane"]?.thinking_level
    expect(recorded).toBe("medium")
    const gate = holdFirstReadBack(f, "at-request")
    const first = f.sdk.setReasoning({ thread: "lane", level: "high" })
    await gate.entered
    expect(await f.sdk.setReasoning({ thread: "lane", level: "medium" })).toMatchObject({ kind: "ok", level: "medium" })
    gate.release()
    await first
    expect(await f.engineLevel()).toBe("medium")
    expect((await f.store.sessionModels(["dur-lane"]))["dur-lane"]?.thinking_level).toBe("medium")
  })
})

describe("#9429 a switch replaced by a switch straight back, on a host that does not report holds", () => {
  test("#given a recorded session #when another client switches it back to the model from before a set-model's switch #then that call answers superseded, because the record moved", async () => {
    const f = sdkFixture()
    await f.sdk.setModel({ thread: "lane", model: "claude-opus-5-5", set_by: "config" })
    const gate = holdFirstReadBack(f, "at-reply")
    const first = f.sdk.setModel({ thread: "lane", model: "gpt-x", set_by: "lead" })
    await gate.entered
    expect(await f.sdk.setModel({ thread: "lane", model: "claude-opus-5-5", set_by: "user" })).toMatchObject({ kind: "ok", model: { ...CLAUDE, set_by: "user" } })
    gate.release()
    const earlier = await first
    expect(earlier).toMatchObject({ kind: "ok", model: { ...CLAUDE, set_by: "user" }, superseded: { provider: "openai", id: "gpt-x" } })
    expect("pending" in earlier).toBe(false)
  })

  test("#given a live session #when its own /model switches back while a set-model's read-back is in flight #then the call answers superseded and the record names the model the engine runs", async () => {
    const e = engineFixture()
    await e.record({ ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "config", reason: null })
    const shared = e.sharedSdk()
    // The engine's own observer writes both switches: the set-model's landing and the /model back.
    const both = e.observed(2)
    shared.beforeStateReply(async () => {
      await e.userSwitch(CLAUDE_MODEL)
      await both
    })
    const result = await shared.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })
    await e.settle()
    expect(e.engine.model).toMatchObject(CLAUDE)
    expect(result).toMatchObject({ kind: "ok", model: CLAUDE, superseded: GPT_Y })
    expect("pending" in result).toBe(false)
    expect(await e.recorded()).toMatchObject(CLAUDE)
  })
})

describe("#9429 a host that reports its held switch", () => {
  /** get_state as an engine that reports holds answers it: `pendingModelSwitch` names the held switch, or null. */
  function reportingHolds(f: ReturnType<typeof sdkFixture>, held: () => { readonly provider: string; readonly id: string } | null) {
    const originalGetState = f.host.getState
    Object.assign(f.host, { getState: async (sessionId: string) => ({ ...((await originalGetState(sessionId)) as object), model: f.models.get(sessionId), pendingModelSwitch: held() }) })
  }

  test("#given a switch replaced by a switch straight back to the model from before it #when the host reports no held switch #then the earlier call answers superseded, not pending", async () => {
    const f = sdkFixture()
    reportingHolds(f, () => null)
    const gate = holdFirstReadBack(f, "at-reply")
    const first = f.sdk.setModel({ thread: "lane", model: "gpt-x", set_by: "config" })
    await gate.entered
    expect(await f.sdk.setModel({ thread: "lane", model: "claude-opus-5-5", set_by: "lead" })).toMatchObject({ kind: "ok", model: { ...CLAUDE, set_by: "lead" } })
    gate.release()
    const earlier = await first
    expect(earlier).toMatchObject({ kind: "ok", model: { ...CLAUDE, set_by: "lead" }, superseded: { provider: "openai", id: "gpt-x" } })
    expect("pending" in earlier).toBe(false)
  })

  test("#given a switch the host reports as held #when set-model returns #then it answers pending and the record keeps the running model", async () => {
    const f = sdkFixture()
    await f.store.recordSessionModel({ now: Date.now(), durable_id: "dur-lane", model: { ...CLAUDE, thinking_level: "medium", provenance: "set", set_by: "config", reason: null } })
    let held: { provider: string; id: string } | null = null
    reportingHolds(f, () => held)
    Object.assign(f.host, { setModel: async (_sessionId: string, provider: string, id: string) => { held = { provider, id }; return { provider, id } } })
    const result = await f.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })
    expect(result).toMatchObject({ kind: "ok", model: { ...CLAUDE, set_by: "config" }, pending: GPT_Y })
    expect("superseded" in result).toBe(false)
    expect((await f.store.sessionModels(["dur-lane"]))["dur-lane"]).toMatchObject({ ...CLAUDE, provenance: "set", set_by: "config" })
  })
})

describe("#9429 the command path and the session's own observer share one store", () => {
  test("#given a live session whose observer records the switch before the command reads the engine back #when set-model runs with --set-by config #then the record and the result say config", async () => {
    const e = engineFixture()
    await e.record({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    const shared = e.sharedSdk()
    const landed = e.observed()
    shared.beforeStateReply(() => landed)
    const result = await shared.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "config" })
    await e.settle()
    expect(e.engine.model).toMatchObject(GPT_Y)
    expect(result).toMatchObject({ kind: "ok", model: { ...GPT_Y, provenance: "set", set_by: "config" } })
    expect(await e.recorded()).toMatchObject({ ...GPT_Y, provenance: "set", set_by: "config" })
  })

  test("#given a live session whose observer records the switch after the command wrote #when set-model runs with --set-by lead #then the record and the result say lead", async () => {
    const e = engineFixture()
    await e.record({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    const shared = e.sharedSdk()
    const result = await shared.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })
    await e.settle()
    expect(result).toMatchObject({ kind: "ok", model: { ...GPT_Y, provenance: "set", set_by: "lead" } })
    expect(await e.recorded()).toMatchObject({ ...GPT_Y, provenance: "set", set_by: "lead" })
  })

  test("#given a session on its fallback model #when a set-reasoning rewrites its record and the engine then reverts #then the record reads the original provenance again", async () => {
    const e = engineFixture()
    await e.record({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
    await e.providerError("429 rate_limit_error")
    const fell = e.observed()
    await e.runtimeSwitch(GPT_Y_MODEL, "fallback")
    await e.settle()
    await fell
    const shared = e.sharedSdk()
    expect(await shared.sdk.setReasoning({ thread: "lane", level: "high" })).toMatchObject({ kind: "ok" })
    expect(await e.recorded()).toMatchObject({ ...GPT_Y, provenance: "fallback" })
    const reverted = e.observed()
    await e.runtimeSwitch(CLAUDE_MODEL, "fallback-revert")
    await e.settle()
    await reverted
    expect(await e.recorded()).toEqual({ ...CLAUDE, thinking_level: "high", provenance: "auto", set_by: null, reason: null })
  })

  test("#given a set-model the engine holds for compaction #when the SDK call returns #then the record keeps the running model's own setter and the result says pending, not superseded", async () => {
    const e = engineFixture()
    const chosen: GatewayStoreModel = { ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "config", reason: null }
    await e.record(chosen)
    const shared = e.sharedSdk()
    e.admission.hold = true
    const result = await shared.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })
    await e.settle()
    expect(e.engine.model).toMatchObject(CLAUDE)
    expect(result).toMatchObject({ kind: "ok", model: chosen, pending: GPT_Y })
    expect("superseded" in result).toBe(false)
    expect(await e.recorded()).toEqual(chosen)
  })

  test("#given a set-model --set-by lead the engine holds for compaction #when the hold lands on a later turn #then the record names the requested model as set by lead", async () => {
    const e = engineFixture()
    await e.record({ ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "config", reason: null })
    const shared = e.sharedSdk()
    e.admission.hold = true
    expect(await shared.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })).toMatchObject({ kind: "ok", pending: GPT_Y })
    await e.settle()
    e.admission.hold = false
    const landed = e.observed()
    // The engine's own apply of a held switch (_applyPendingModelSwitch): a "set" switch that may not defer again.
    await e.engine._switchActiveModel(GPT_Y_MODEL, { persistDefault: false, appendSessionEntry: true, emitModelSelect: true, modelSelectSource: "set", invalidateCompaction: true, allowDeferral: false })
    await e.settle()
    await landed
    expect(e.engine.model).toMatchObject(GPT_Y)
    expect(await e.recorded()).toMatchObject({ ...GPT_Y, provenance: "set", set_by: "lead" })
  })

  test("#given a held set-model --set-by lead #when the user lands another switch first and then picks the held model himself #then the held choice is gone and that pick is the user's", async () => {
    const e = engineFixture()
    await e.record({ ...CLAUDE, thinking_level: "high", provenance: "set", set_by: "config", reason: null })
    const shared = e.sharedSdk()
    e.admission.hold = true
    expect(await shared.sdk.setModel({ thread: "lane", model: "gpt-y", set_by: "lead" })).toMatchObject({ kind: "ok", pending: GPT_Y })
    await e.settle()
    e.admission.hold = false
    const away = e.observed()
    await e.userSwitch(CLAUDE_MODEL)
    await e.settle()
    await away
    expect(await e.recorded()).toMatchObject({ ...CLAUDE, provenance: "set", set_by: "config" })
    const back = e.observed()
    await e.userSwitch(GPT_Y_MODEL)
    await e.settle()
    await back
    expect(await e.recorded()).toMatchObject({ ...GPT_Y, provenance: "set", set_by: "user" })
  })
})

/**
 * The SDK over the pinned engine's own `setModel` and level clamp (`gateway/testing/engine-session.ts`),
 * behind a host that answers like senpi's rpc host and the live surface: a switch senpi holds for a
 * compaction, one it refuses, and a session it opens at a level the model cannot run.
 */
describe("#9425 set-model and create over the engine's own model code", () => {
  const MODELS: readonly HarnessModel[] = [{ provider: "openai", id: "primary", levels: "xhigh" }, { provider: "openai", id: "candidate", levels: "xhigh" }, { provider: "openai", id: "capped", levels: "high" }]
  function engineSdk(host?: (base: ThreadHost) => ThreadHost) {
    const agentDir = scratch("thread-9429-setmodel-")
    const store = createGatewayStore({ agentDir })
    const engine = createEngineSession({ models: MODELS, initial: "primary", thinkingLevel: "high", handlers: () => new Map() })
    const sessions = [engine]
    const base = engineHost(MODELS, sessions)
    const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa", host: host === undefined ? base : host(base), store, modelProfile: () => ({ model_profile: "recommended" }) })
    disposables.push(sdk)
    const record = () => store.recordSessionModel({ now: Date.now(), durable_id: engine.durableId, model: { provider: "openai", id: "primary", thinking_level: "high", provenance: "set", set_by: "config", reason: null } })
    return { engine, sessions, sdk, record }
  }

  test("#given a switch the engine holds for a compaction #when set-model runs #then it answers pending and models keeps naming the model in force", async () => {
    const { engine, sdk, record } = engineSdk()
    await record()
    engine.verdicts.hold.add("candidate")
    expect(await sdk.setModel({ thread: "lane-1", model: "candidate", set_by: "lead" })).toMatchObject({ kind: "ok", model: { id: "primary", set_by: "config" }, pending: { provider: "openai", id: "candidate" } })
    expect(engine.session.model?.id).toBe("primary")
    expect(await sdk.models({ thread: "lane-1" })).toMatchObject({ kind: "ok", current: { id: "primary", set_by: "config" } })
  })

  test("#given a switch the engine refuses after its model_select hook #when set-model runs #then it is unsupported with the engine's reason and nothing changes", async () => {
    const { engine, sdk, record } = engineSdk()
    await record()
    engine.verdicts.refuse.add("candidate")
    expect(await sdk.setModel({ thread: "lane-1", model: "candidate" })).toMatchObject({ kind: "error", error: { code: "unsupported", details: { model: "openai/candidate", reason: expect.stringContaining("does not fit candidate") } } })
    expect(engine.session.model?.id).toBe("primary")
    expect(await sdk.models({ thread: "lane-1" })).toMatchObject({ kind: "ok", current: { id: "primary", set_by: "config" } })
  })

  test("#given a host whose catalog names no thinking levels #when create asks for a level the model cannot run #then the record names the level the engine opened at", async () => {
    const { sessions, sdk } = engineSdk((base) => ({ ...base, availableModels: async () => (await base.availableModels?.() ?? []).map(({ provider, id, name }) => ({ provider, id, ...(name === undefined ? {} : { name }) })) }))
    const created = await sdk.create({ name: "capped-lane", model: "capped", thinking: "xhigh" })
    expect(sessions.at(-1)?.session.thinkingLevel).toBe("high")
    expect(created).toMatchObject({ kind: "ok", thread: { model: { id: "capped", thinking_level: "high" } } })
    expect(await sdk.models({ thread: "capped-lane" })).toMatchObject({ kind: "ok", current: { id: "capped", thinking_level: "high" } })
  })
})

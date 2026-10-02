import { AgentSession, SessionManager } from "@code-yeongyu/senpi"

import type { ModelCatalogEntry, ThreadHost, ThreadHostSession } from "../../tools/ports"

/**
 * A session running the pinned engine's OWN model and thinking-level code: `setModel`/`_setModel`,
 * `_switchActiveModel` (the `model_select` hook, then deferral and admission, then the rollback a
 * refused or held switch does), `_emitModelSelect`, `_setThinkingLevel` and `_clampThinkingLevel`,
 * over a real in-memory `SessionManager`. Only services unrelated to the switch decision are doubles
 * (settings, service tier, compaction, auth), plus two injectable verdicts: `refuse` makes the
 * admission throw once the candidate's `model_select` hook has run (the post-hook revalidation, as when
 * a hook grew the system prompt past the window), `hold` makes the deferral hold the switch for a
 * compaction. No provider request is ever made.
 */

export type EngineModel = { readonly provider: string; readonly id: string; readonly levels: "high" | "xhigh" }

const BASE = { api: "openai-completions", reasoning: true, contextWindow: 200_000, maxTokens: 8_000, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, baseUrl: "http://127.0.0.1:9" }

function engineModel(model: EngineModel) {
  return { ...BASE, provider: model.provider, id: model.id, name: model.id, thinkingLevelMap: model.levels === "high" ? { xhigh: null, max: null } : { xhigh: "xhigh", max: null } }
}

type Handler = (event: unknown, ctx?: unknown) => unknown

export type EngineSession = ReturnType<typeof createEngineSession>

export function createEngineSession(options: { readonly models: readonly EngineModel[]; readonly initial: string; readonly thinkingLevel: string; readonly handlers: () => ReadonlyMap<string, readonly Handler[]> }) {
  const models = options.models.map(engineModel)
  const find = (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id)
  const initial = models.find((model) => model.id === options.initial)
  if (initial === undefined) throw new Error(`no model ${options.initial}`)
  const sessionManager = SessionManager.inMemory(process.cwd())
  const verdicts = { refuse: new Set<string>(), hold: new Set<string>() }
  const hooked = new Set<string>()
  const session = Object.create(AgentSession.prototype) as AgentSession & Record<string, unknown>
  // The runner's per-session context: `model` is a live getter, as senpi's runner.js builds it.
  const ctx = { sessionManager, get model() { return session.model } }
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    for (const handler of options.handlers().get(type) ?? []) await handler({ ...event, type }, ctx)
  }
  Object.assign(session, {
    agent: { state: { model: initial, thinkingLevel: options.thinkingLevel, systemPrompt: "base", messages: [], tools: [] }, abortServerSideFallback: false },
    sessionManager,
    settingsManager: {
      getAbortServerSideFallback: () => false,
      getModelThinkingLevel: () => undefined,
      getDefaultThinkingLevel: () => undefined,
      setDefaultModelAndProvider() {},
      setModelThinkingLevel() {},
      setDefaultThinkingLevel() {},
    },
    _retryFallback: { hasConfiguredChain: () => false, noteManualThinkingLevel() {}, clearForManualModelChange() {}, activeState: undefined },
    _probeBackScheduler: { cancel() {} },
    _modelRuntime: { checkAuth: async () => true, getCompatibilityRequestConfig: () => ({}) },
    _scopedModels: [],
    _sessionFastMode: false,
    _currentServiceTier: undefined,
    _shownHighReasoningWarningKeys: new Set<string>(),
    _baseSystemPromptOptions: {},
    _extensionRunner: {
      emitModelSelect: async (event: Record<string, unknown>) => {
        hooked.add(String((event.model as { readonly id?: unknown } | undefined)?.id))
        await dispatch("model_select", event)
        return undefined
      },
      emit: async (event: Record<string, unknown>) => { await dispatch(String(event.type), event) },
    },
    _emit() {},
    syncPromptCacheSafeWaitEnv() {},
    _invalidateCompactionForModelSelection() {},
    _getDownswitchLiveContextTokens: () => 0,
    _modelSwitchAdmission: () => "switch",
    _projectSwitchDeferral: (model: { readonly id: string }) => (verdicts.hold.has(model.id) ? { contextWindow: 200_000, liveContextTokens: 190_000, requiredTokens: 230_000, shortfallTokens: 30_000, usable: false, verdict: "fits-after-compaction" } : undefined),
    assertModelUsable: (model: { readonly id: string }) => {
      if (verdicts.refuse.has(model.id) && hooked.delete(model.id)) throw new Error(`the session's context does not fit ${model.id}`)
    },
  })
  const fallbackOptions = (reason: "fallback" | "fallback-revert") => ({ persistDefault: false, appendSessionEntry: true, entryReason: reason, emitModelSelect: true, modelSelectSource: reason, invalidateCompaction: true, allowDeferral: false, repairWithSlice: false })
  return {
    session,
    ctx,
    durableId: sessionManager.getSessionId(),
    verdicts,
    find,
    catalog: (): ModelCatalogEntry[] => models.map((model) => ({ provider: model.provider, id: model.id, name: model.name, thinking_levels: session.getAvailableThinkingLevels.call({ model }) })),
    /** The retry controller's `switchModel` (agent-session.js): a fallback or its revert. */
    fallback: async (id: string, reason: "fallback" | "fallback-revert" = "fallback") => {
      const model = models.find((candidate) => candidate.id === id)
      if (model === undefined) throw new Error(`no model ${id}`)
      await (session as unknown as { _switchActiveModel: (model: unknown, opts: unknown) => Promise<unknown> })._switchActiveModel(model, fallbackOptions(reason))
    },
    /** A resume re-applying the persisted model. */
    restore: async (id: string) => {
      const model = models.find((candidate) => candidate.id === id)
      await (session as unknown as { _switchActiveModel: (model: unknown, opts: unknown) => Promise<unknown> })._switchActiveModel(model, { persistDefault: false, appendSessionEntry: false, emitModelSelect: true, modelSelectSource: "restore", invalidateCompaction: false })
    },
  }
}

/**
 * One rpc host over engine sessions, answering each command the way senpi's
 * `modes/rpc/connection-handler.js` does: `set_model` looks the model up and runs `session.setModel`,
 * `set_thinking_level` validates first only for `scope: "turn"` and otherwise runs the clamping
 * `session.setThinkingLevel`, `get_state` reports the live model and level, and `open_session` starts
 * a new engine session on the model and level it is given.
 */
export function engineHost(models: readonly EngineModel[], sessions: EngineSession[], socket = "/tmp/i-9429engine000000.sock"): ThreadHost {
  const names = new Map<EngineSession, string | null>()
  const row = (entry: EngineSession, index: number): ThreadHostSession => ({ sessionId: `rpc-${index + 1}`, durableSessionId: entry.durableId, cwd: process.cwd(), name: names.has(entry) ? (names.get(entry) ?? null) : `lane-${index + 1}`, status: "open", socket, endpoint_kind: "rpc_host" })
  const rows = (): ThreadHostSession[] => sessions.map(row)
  const of = (sessionId: string) => {
    const entry = sessions[Number(sessionId.replace("rpc-", "")) - 1]
    if (entry === undefined) throw new Error(`no session ${sessionId}`)
    return entry
  }
  const catalog = (): ModelCatalogEntry[] => createEngineSession({ models, initial: models[0]?.id ?? "", thinkingLevel: "off", handlers: () => new Map() }).catalog()
  return {
    socket: "/tmp/thread-9429-legacy.sock",
    listSessions: async () => rows(),
    listView: async () => ({ sessions: rows(), hosts: [{ socket, list_sessions: { sessions: rows() }, endpoint_kind: "rpc_host", alive: true }], disk: [] }),
    openSession: async (params) => {
      const entry = createEngineSession({ models, initial: params.modelId ?? models[0]?.id ?? "", thinkingLevel: params.thinkingLevel ?? "medium", handlers: () => new Map() })
      sessions.push(entry)
      names.set(entry, params.name ?? null)
      return { ...row(entry, sessions.length - 1), thinkingLevel: entry.session.thinkingLevel } as ThreadHostSession
    },
    availableModels: async () => catalog(),
    getMessages: async () => [],
    getState: async (sessionId) => {
      const { session } = of(sessionId)
      return { isStreaming: false, thinkingLevel: session.thinkingLevel, model: session.model }
    },
    prompt: async () => ({}),
    interrupt: async () => ({ interrupted: false }),
    setSessionName: async () => {},
    setModel: async (sessionId, provider, modelId) => {
      const entry = of(sessionId)
      const model = entry.find(provider, modelId)
      if (model === undefined) throw new Error(`Model not found: ${provider}/${modelId}`)
      try {
        await entry.session.setModel(model as never)
      } catch (error) {
        // live-surface.ts maps senpi's refusal frame to this classified error.
        throw new Error(`model_refused:${error instanceof Error ? error.message : String(error)}`)
      }
      return { ...model }
    },
    getAvailableModels: async (sessionId) => of(sessionId).catalog(),
    setThinkingLevel: async (sessionId, level, scope) => {
      const { session } = of(sessionId)
      if (scope === "turn") {
        if (!session.getAvailableThinkingLevels().includes(level as never)) throw new Error(`Thinking level ${level} is not supported by the active model.`)
        session.setSessionThinkingLevel(level as never)
      } else {
        session.setThinkingLevel(level as never)
      }
    },
    getAvailableThinkingLevels: async (sessionId) => of(sessionId).session.getAvailableThinkingLevels(),
  }
}

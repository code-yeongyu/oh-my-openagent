import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import type { OhMyOpenCodeConfig } from "../config"
import { validatePluginConfig } from "../config/validate"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { parseModelString } from "../shared/model-string-parser"
import { log } from "../shared/logger"
import { buildFallbackChainFromModels } from "../shared/fallback-chain-from-models"
import { AGENT_MODEL_REQUIREMENTS } from "../shared/model-requirements"
import { setSessionFallbackSnapshot, clearSessionFallbackSnapshot } from "../shared/session-fallback-snapshot"
import { createRuntimeModelConfigLoader } from "./runtime-model-config"

type ModelConfig = Pick<OhMyOpenCodeConfig, "agents" | "categories">
type Selection = { name?: string; config: ModelConfig }
type PrimaryBaseline = { model?: unknown; variant?: unknown }
type SessionReader = (id: string) => Promise<{ parentID?: string }>

export type SessionModelProfiles = ReturnType<typeof createSessionModelProfiles>

/** Selectors and accepted snapshots belong to this plugin instance, never process.env. */
export function createSessionModelProfiles(args: {
  directory: string
  initialConfig: OhMyOpenCodeConfig
  readSession: SessionReader
  environment?: OmoConfigEnv
  onSelectionChanged?: (sessionID: string) => void
}) {
  const environment = { ...(args.environment ?? process.env) }
  const selections = new Map<string, Selection>()
  const parents = new Map<string, string | undefined>()
  const baselineModels = new Map<string, Map<string, PrimaryBaseline>>()
  const requests = new Map<string, Map<string, ModelConfig>>()
  const loadDefault = createRuntimeModelConfigLoader(args.directory, args.initialConfig, environment)

  async function rootSession(id: string): Promise<string> {
    const visited = new Set<string>()
    while (!visited.has(id) && visited.size < 64) {
      visited.add(id)
      if (!parents.has(id)) parents.set(id, (await args.readSession(id)).parentID)
      const parent = parents.get(id)
      if (!parent) return id
      id = parent
    }
    throw new Error("Cannot resolve session profile: invalid session ancestry")
  }

  function readConfig(name?: string): ModelConfig {
    const selectedEnv = name === undefined ? environment : { ...environment, OMO_PROFILE: name }
    const result = validatePluginConfig(args.directory, selectedEnv)
    if (!result.valid || result.messages.length > 0 || result.warnings.length > 0) {
      throw new Error([...result.messages, ...result.warnings].join("\n"))
    }
    return { agents: result.config.agents, categories: result.config.categories }
  }

  function reload(selection: Selection): ModelConfig {
    try {
      selection.config = readConfig(selection.name)
    } catch (error) {
      log("[session-model-profiles] Reload rejected; retaining the accepted session snapshot", { error: String(error) })
    }
    return selection.config
  }

  async function load(sessionID: string): Promise<ModelConfig> {
    const selection = selections.get(await rootSession(sessionID))
    return selection ? reload(selection) : loadDefault()
  }

  async function inspect(sessionID: string) {
    const root = await rootSession(sessionID)
    const loaded = loadOmoConfig({ cwd: args.directory, env: environment })
    const availableProfiles = [...new Set(loaded.layers.flatMap((layer) => Object.keys(layer.config.profiles ?? {})))].sort()
    const selection = selections.get(root)
    return {
      sessionID: root,
      profile: selection?.name ?? loaded.profile ?? null,
      source: selection?.name === undefined ? "startup" as const : "session" as const,
      availableProfiles,
    }
  }

  async function select(sessionID: string, name: string | undefined): Promise<void> {
    if (await rootSession(sessionID) !== sessionID) {
      throw new Error("Switch profiles in the parent session; existing child continuations keep their resolved model.")
    }
    if (name !== undefined && !name.trim()) throw new Error("A nonblank profile name is required")
    const config = readConfig(name)
    selections.set(sessionID, { name, config })
    args.onSelectionChanged?.(sessionID)
  }

  async function command(sessionID: string, value: string): Promise<string> {
    const argument = value.trim()
    if (argument === "" || argument === "list" || argument === "current") {
      const state = await inspect(sessionID)
      return `Session model profile: ${state.profile ?? "base"}. Available: ${state.availableProfiles.join(", ") || "(none)"}. Use /omo-profile <name> or /omo-profile clear.`
    }
    const name = argument === "clear" ? undefined : /^use(?:\s|$)/.test(argument) ? argument.slice(3).trim() : argument
    await select(sessionID, name)
    return `Session model profile: ${name ?? "startup selection"}. Applies to subsequent primary requests and new delegations. Existing children keep their resolved models; agent registrations, hooks and providers retain startup settings.`
  }

  async function applyPrimary(sessionID: string, agent: string | undefined, message: Record<string, unknown>): Promise<ModelConfig | undefined> {
    const requestID = typeof message.id === "string" ? message.id : undefined
    const request = requestID ? requests.get(sessionID)?.get(requestID) : undefined
    if (request) return request
    const selection = selections.get(sessionID)
    if (!selection) return // Children and unselected sessions retain explicit host/dispatch models.
    const effectiveAgent = agent ?? (typeof message.agent === "string" ? message.agent : undefined)
    const agentKey = effectiveAgent ? getAgentConfigKey(effectiveAgent) : undefined
    const config = reload(selection)
    if (requestID) {
      const sessionRequests = requests.get(sessionID) ?? new Map<string, ModelConfig>()
      sessionRequests.set(requestID, config)
      requests.set(sessionID, sessionRequests)
    }
    const override = agentKey ? config.agents?.[agentKey] : undefined
    const category = override?.category ? config.categories?.[override.category] : undefined
    const model = parseModelString(override?.model ?? category?.model ?? "")
    const baselines = baselineModels.get(sessionID) ?? new Map<string, PrimaryBaseline>()
    const baseline = baselines.get(agentKey ?? "") ?? {}
    if (model) {
      if (!("model" in baseline)) baseline.model = message.model
      message.model = { providerID: model.providerID, modelID: model.modelID }
    } else if ("model" in baseline) {
      message.model = baseline.model
      delete baseline.model
    }
    const variant = override?.variant ?? category?.variant ?? model?.variant
    const reasoning = override?.reasoning ?? category?.reasoning
    if (model || variant !== undefined || reasoning !== undefined) {
      if (!("variant" in baseline)) baseline.variant = message.variant
      if (variant !== undefined) message.variant = variant
      else delete message.variant
    } else if ("variant" in baseline) {
      if (baseline.variant !== undefined) message.variant = baseline.variant
      else delete message.variant
      delete baseline.variant
    }
    if (Object.keys(baseline).length > 0) {
      baselines.set(agentKey ?? "", baseline)
      baselineModels.set(sessionID, baselines)
    } else {
      baselines.delete(agentKey ?? "")
      if (baselines.size === 0) baselineModels.delete(sessionID)
    }
    const effectiveModel = message.model
    const providerID = typeof effectiveModel === "object" && effectiveModel !== null && "providerID" in effectiveModel && typeof effectiveModel.providerID === "string"
      ? effectiveModel.providerID
      : undefined
    const fallbacks = override?.fallback_models ?? category?.fallback_models
    const chain = fallbacks === undefined
      ? (agentKey ? AGENT_MODEL_REQUIREMENTS[agentKey]?.fallbackChain : undefined)
      : buildFallbackChainFromModels(fallbacks, providerID)
    setSessionFallbackSnapshot(sessionID, chain)
    return config
  }

  function clearSession(sessionID: string): void {
    selections.delete(sessionID)
    parents.delete(sessionID)
    baselineModels.delete(sessionID)
    requests.delete(sessionID)
    clearSessionFallbackSnapshot(sessionID)
  }

  return { load, inspect, select, command, applyPrimary, clearSession, primaryConfig: (id: string, messageID?: unknown) => {
    const request = typeof messageID === "string" ? requests.get(id)?.get(messageID) : undefined
    return request ?? selections.get(id)?.config
  } }
}

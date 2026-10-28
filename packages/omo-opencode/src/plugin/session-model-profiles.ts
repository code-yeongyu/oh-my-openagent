import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import type { OhMyOpenCodeConfig } from "../config"
import { validatePluginConfig } from "../config/validate"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { parseModelString } from "../shared/model-string-parser"
import { log } from "../shared/logger"
import { createRuntimeModelConfigLoader } from "./runtime-model-config"

type ModelConfig = Pick<OhMyOpenCodeConfig, "agents" | "categories">
type Selection = { name?: string; config: ModelConfig }
type SessionReader = (id: string) => Promise<{ parentID?: string }>

export type SessionModelProfiles = ReturnType<typeof createSessionModelProfiles>

/** Selectors and accepted snapshots belong to this plugin instance, never process.env. */
export function createSessionModelProfiles(args: {
  directory: string
  initialConfig: OhMyOpenCodeConfig
  readSession: SessionReader
  environment?: OmoConfigEnv
}) {
  const environment = { ...(args.environment ?? process.env) }
  const selections = new Map<string, Selection>()
  const parents = new Map<string, string | undefined>()
  const baselineModels = new Map<string, unknown>()
  const requests = new Map<string, { id: unknown; config: ModelConfig }>()
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

  async function command(sessionID: string, value: string): Promise<string> {
    const root = await rootSession(sessionID)
    if (root !== sessionID) throw new Error("Switch profiles in the parent session; existing child continuations keep their resolved model.")
    const argument = value.trim()
    if (argument === "" || argument === "list" || argument === "current") {
      const loaded = loadOmoConfig({ cwd: args.directory, env: environment })
      const names = [...new Set(loaded.layers.flatMap((layer) => Object.keys(layer.config.profiles ?? {})))].sort()
      const selection = selections.get(sessionID)
      return `Session model profile: ${selection?.name ?? loaded.profile ?? "base"}. Available: ${names.join(", ") || "(none)"}. Use /omo-profile <name> or /omo-profile clear.`
    }
    const name = argument === "clear" ? undefined : argument.startsWith("use ") ? argument.slice(4).trim() : argument
    if (name !== undefined && !name.trim()) throw new Error("A nonblank profile name is required")
    // Validate before committing the selector; a missing profile is a config diagnostic.
    const config = readConfig(name)
    selections.set(sessionID, { name, config })
    return `Session model profile: ${name ?? "startup selection"}. Applies to subsequent primary requests and new delegations. Existing children keep their resolved models; prompts, tools, hooks and providers retain startup settings.`
  }

  async function applyPrimary(sessionID: string, agent: string | undefined, message: Record<string, unknown>): Promise<ModelConfig | undefined> {
    const selection = selections.get(sessionID)
    if (!selection) return // Children and unselected sessions retain explicit host/dispatch models.
    if (!baselineModels.has(sessionID)) baselineModels.set(sessionID, message.model)
    const config = reload(selection)
    requests.set(sessionID, { id: message.id, config })
    const override = agent ? config.agents?.[getAgentConfigKey(agent)] : undefined
    const category = override?.category ? config.categories?.[override.category] : undefined
    const model = parseModelString(override?.model ?? category?.model ?? "")
    message.model = model ? { providerID: model.providerID, modelID: model.modelID } : baselineModels.get(sessionID)
    if (override?.variant ?? category?.variant ?? model?.variant) message.variant = override?.variant ?? category?.variant ?? model?.variant
    else delete message.variant
    return config
  }

  function clearSession(sessionID: string): void {
    selections.delete(sessionID)
    parents.delete(sessionID)
    baselineModels.delete(sessionID)
    requests.delete(sessionID)
  }

  return { load, command, applyPrimary, clearSession, primaryConfig: (id: string, messageID?: unknown) => {
    const request = requests.get(id)
    return request && messageID !== undefined && request.id === messageID ? request.config : selections.get(id)?.config
  } }
}

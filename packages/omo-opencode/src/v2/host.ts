import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import { setVersionCache } from "../shared/opencode-version"
import { createAdapterState } from "./adapter-state"
import { createV1PluginInput } from "./context-facade"
import { registerV1Hooks, type V1HookMap } from "./hook-bridge"
import { projectV1Surface } from "./project-config"

type V1Server = (input: never, options: unknown) => Promise<V1HookMap>

const MODEL_LIST_TIMEOUT_MS = 2_000

// Local fix 47: hand the shared backend event loop back between setup stages of a new folder.
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord)
  return []
}

type SeededProviders = Map<string, { provider: Record<string, unknown>; models: Map<string, Record<string, unknown>> }>

/**
 * Local fix 51: on V1, OpenCode hands the config hook the user's provider map, and
 * applyProviderConfig fills the context-limit cache from each model's `limit.context`.
 * V2 owns provider config itself, so the hook receives an empty object, the cache stays
 * empty, and preemptive compaction skips every non-Anthropic model with "unknown context
 * limit". Seed the provider map with the limits the host's model catalog already carries.
 */
async function seedModelContextLimits(ctx: Plugin.Context, config: Record<string, unknown>): Promise<SeededProviders> {
  const seeded: SeededProviders = new Map()
  let listed: unknown
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), MODEL_LIST_TIMEOUT_MS)
    })
    listed = await Promise.race([ctx.model.list(), timeout]).finally(() => clearTimeout(timer))
  } catch (error) {
    log("[oh-my-openagent] model context limits unavailable", {
      error: error instanceof Error ? error.message : String(error),
    })
    return seeded
  }

  const providers: Record<string, unknown> = {}
  for (const model of rowsOf(listed)) {
    const providerID = typeof model.providerID === "string" ? model.providerID : undefined
    const context = isRecord(model.limit) && typeof model.limit.context === "number" ? model.limit.context : undefined
    if (!providerID || !context || context <= 0) continue
    // Sessions name a model by its catalog id; modelID is the API id when the two differ.
    const ids = [model.id, model.modelID].filter((id): id is string => typeof id === "string" && id.length > 0)
    for (const modelID of ids) {
      let entry = seeded.get(providerID)
      if (!entry) {
        entry = { provider: { models: {} }, models: new Map() }
        seeded.set(providerID, entry)
        providers[providerID] = entry.provider
      }
      if (entry.models.has(modelID)) continue
      const modelConfig = { limit: { context } }
      entry.models.set(modelID, modelConfig)
      ;(entry.provider.models as Record<string, unknown>)[modelID] = modelConfig
    }
  }
  if (seeded.size > 0) config.provider = providers
  log("[oh-my-openagent] v2 model context limits seeded", { models: [...seeded.values()].reduce((sum, entry) => sum + entry.models.size, 0) })
  return seeded
}

/** Drops the seed again so it is not projected back onto the host as V1-declared providers. */
function unseedModelContextLimits(config: Record<string, unknown>, seeded: SeededProviders): void {
  if (seeded.size === 0 || !isRecord(config.provider)) return
  const providers = config.provider
  for (const [providerID, entry] of seeded) {
    if (providers[providerID] !== entry.provider) continue
    // A provider the plugin itself configured keeps its entry; the seeded models only carry limits.
    if (Object.keys(entry.provider).some((key) => key !== "models")) continue
    const models = isRecord(entry.provider.models) ? entry.provider.models : {}
    const untouched = Object.entries(models).every(([modelID, modelConfig]) => entry.models.get(modelID) === modelConfig)
    if (untouched) delete providers[providerID]
  }
  if (Object.keys(providers).length === 0) delete config.provider
}

export async function setupOpenCodeV2(
  ctx: Plugin.Context,
  deps: {
    server: V1Server
    agentDirectory?: string
  },
): Promise<(() => Promise<void> | void) | void> {
  if (typeof ctx.app.version === "string" && ctx.app.version.length > 0) setVersionCache(ctx.app.version)
  const state = createAdapterState(`${ctx.location.directory}/.omo/v2-state`)
  const v1Input = createV1PluginInput(ctx, { state })
  let hooks: V1HookMap
  try {
    hooks = await deps.server(v1Input as never, ctx.options)
  } catch (error) {
    log("[oh-my-openagent] plugin startup failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  if (!isRecord(hooks) || Object.keys(hooks).length === 0) {
    log("[oh-my-openagent] plugin startup returned no hooks")
    return
  }

  await yieldToEventLoop()
  const stopEvents = await registerV1Hooks(ctx, hooks, state)
  await yieldToEventLoop()
  const scratch: Record<string, unknown> = {}
  if (typeof hooks.config === "function") {
    const seeded = await seedModelContextLimits(ctx, scratch)
    try {
      await hooks.config(scratch)
    } catch (error) {
      log("[oh-my-openagent] config projection failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    unseedModelContextLimits(scratch, seeded)
  }

  await yieldToEventLoop()
  try {
    await projectV1Surface({
      ctx,
      directory: v1Input.directory,
      config: scratch,
      tools: hooks.tool,
      defineTool: hooks["tool.definition"],
      commandBefore: typeof hooks["command.execute.before"] === "function"
        ? hooks["command.execute.before"] as (commandInput: { command: string; sessionID: string; arguments: string }, output: { parts: Array<{ type: string; text?: string }> }) => Promise<void>
        : undefined,
      ...(deps.agentDirectory ? { agentDirectory: deps.agentDirectory } : {}),
      recordTodos: { read: state.todos, write: state.recordTodos },
    })
  } catch (error) {
    log("[oh-my-openagent] domain projection failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const dispose = hooks.dispose
  return async () => {
    stopEvents()
    if (typeof dispose === "function") await dispose()
  }
}

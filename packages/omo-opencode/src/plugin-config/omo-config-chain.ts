import { isPlainRecord } from "@oh-my-opencode/utils"
import {
  loadOmoConfig,
  mergeOmoConfigRecords,
  OmoConfigSchema,
  type OmoConfigEnv,
  resolveModelReferences,
  resolveOmoConfigView,
} from "@oh-my-opencode/omo-config-core"

export type OmoOpenCodeConfigView = {
  readonly config: Record<string, unknown>
  readonly path: string
}

export type OmoOpenCodeConfigChain = {
  readonly diagnostics: readonly { readonly message: string; readonly path: string }[]
  readonly protectedUserView: Record<string, unknown>
  readonly views: readonly OmoOpenCodeConfigView[]
}

const NON_PLUGIN_FIELDS = new Set(["legacy_migrations", "models", "task", "teams"])

function block(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const value = config["[opencode]"]
  return isPlainRecord(value) ? value : {}
}

function profile(config: Readonly<Record<string, unknown>>, name: string | undefined): Record<string, unknown> {
  if (name === undefined) return {}
  const profiles = config.profiles
  if (!isPlainRecord(profiles)) return {}
  const selected = profiles[name]
  return isPlainRecord(selected) ? selected : {}
}

function baseView(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || (key.startsWith("[") && key.endsWith("]")) || NON_PLUGIN_FIELDS.has(key)) continue
    result[key] = value
  }
  return result
}

function appendViews(
  views: OmoOpenCodeConfigView[],
  layers: ReturnType<typeof loadOmoConfig>["layers"],
  select: (config: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): void {
  for (const layer of layers) {
    const config = select(layer.config)
    if (Object.keys(config).length > 0) views.push({ config, path: layer.source.path })
  }
}

function recordFields(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in value) result[field] = value[field]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function modelInput(view: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const agents = isPlainRecord(view.agents)
    ? Object.fromEntries(Object.entries(view.agents).flatMap(([name, definition]) => {
      const fields = recordFields(definition, ["description", "prompt", "model", "models", "variant", "reasoningEffort", "tools", "temperature", "disable"])
      return fields === undefined ? [] : [[name, fields]]
    }))
    : undefined
  const categories = isPlainRecord(view.categories)
    ? Object.fromEntries(Object.entries(view.categories).flatMap(([name, definition]) => {
      const fields = recordFields(definition, ["description", "model", "fallback_models", "variant", "temperature", "top_p", "maxTokens", "thinking", "reasoningEffort", "textVerbosity", "tools", "prompt_append", "max_prompt_tokens", "is_unstable_agent", "disable"])
      return fields === undefined ? [] : [[name, fields]]
    }))
    : undefined

  return {
    ...(isPlainRecord(view.models) ? { models: view.models } : {}),
    ...(agents === undefined ? {} : { agents }),
    ...(categories === undefined ? {} : { categories }),
  }
}

function modelView(view: Readonly<Record<string, unknown>>): {
  readonly config: Record<string, unknown>
  readonly diagnostics: readonly { readonly message: string; readonly path: string }[]
} {
  const parsed = OmoConfigSchema.safeParse(modelInput(view))
  if (!parsed.success) return { config: {}, diagnostics: [] }

  const resolved = resolveModelReferences(parsed.data)
  return {
    config: {
      ...(resolved.view.agents === undefined ? {} : { agents: resolved.view.agents }),
      ...(resolved.view.categories === undefined ? {} : { categories: resolved.view.categories }),
    },
    diagnostics: resolved.diagnostics,
  }
}

export function loadOmoOpenCodeConfigChain(
  directory: string,
  environment: OmoConfigEnv = process.env,
): OmoOpenCodeConfigChain {
  const loaded = loadOmoConfig({ cwd: directory, env: environment })
  const merged = loaded.layers.reduce<Record<string, unknown>>(
    (config, layer) => mergeOmoConfigRecords(config, layer.config),
    {},
  )
  const resolved = resolveOmoConfigView({
    config: merged,
    harness: "opencode",
    ...(loaded.profile === undefined ? {} : { profile: loaded.profile }),
  })
  const views: OmoOpenCodeConfigView[] = []
  const selectedProfile = loaded.profile

  appendViews(views, loaded.layers, baseView)
  appendViews(views, loaded.layers, block)
  appendViews(views, loaded.layers, (config) => baseView(profile(config, selectedProfile)))
  appendViews(views, loaded.layers, (config) => block(profile(config, selectedProfile)))

  const resolvedModels = modelView(resolved.config)
  if (Object.keys(resolvedModels.config).length > 0) {
    const source = loaded.layers[0]?.source.path ?? directory
    views.push({ config: resolvedModels.config, path: source })
  }

  let protectedUserView: Record<string, unknown> = {}
  for (const layer of loaded.layers) {
    if (layer.source.scope !== "user") continue
    protectedUserView = mergeOmoConfigRecords(protectedUserView, block(layer.config))
  }
  for (const layer of loaded.layers) {
    if (layer.source.scope !== "user") continue
    protectedUserView = mergeOmoConfigRecords(protectedUserView, block(profile(layer.config, selectedProfile)))
  }

  return {
    diagnostics: [
      ...loaded.diagnostics,
      ...resolvedModels.diagnostics,
    ],
    protectedUserView,
    views,
  }
}

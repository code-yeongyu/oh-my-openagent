import type { V2ModelInfo, V2PluginContext } from "../context-types"

/** The 1.x model metadata fields the plugin reads, derived from a 2.x model. */
function toV1Model(model: V2ModelInfo): Record<string, unknown> {
  return {
    id: model.modelID,
    providerID: model.providerID,
    name: model.name,
    status: model.status,
    attachment: model.capabilities.input.some((kind) => kind !== "text"),
    reasoning: model.variants.length > 0,
    temperature: true,
    tool_call: model.capabilities.tools,
    modalities: { input: [...model.capabilities.input], output: [...model.capabilities.output] },
    limit: {
      context: model.limit.context,
      output: model.limit.output,
      ...(model.limit.input === undefined ? {} : { input: model.limit.input }),
    },
    options: {},
    variants: Object.fromEntries(model.variants.map((variant) => [variant.id, {}])),
  }
}

/**
 * `provider.list()` in the 1.x shape `{ data: { all, default, connected } }`. A provider counts as
 * connected when the host lists at least one enabled model for it.
 */
export function createProviderNamespace(context: V2PluginContext) {
  return {
    list: async () => {
      const [providers, models, defaultModel] = await Promise.all([
        context.provider.list(),
        context.model.list(),
        context.model.default(),
      ])
      const modelsByProvider = new Map<string, V2ModelInfo[]>()
      for (const model of models.data) modelsByProvider.set(model.providerID, [...(modelsByProvider.get(model.providerID) ?? []), model])
      const known = new Map<string, string>(providers.data.map((provider) => [provider.id, provider.name]))
      for (const providerID of modelsByProvider.keys()) if (!known.has(providerID)) known.set(providerID, providerID)
      const all = [...known].map(([id, name]) => ({
        id,
        name,
        source: "api",
        env: [] as string[],
        options: {},
        models: Object.fromEntries((modelsByProvider.get(id) ?? []).map((model) => [model.modelID, toV1Model(model)])),
      }))
      const connected = all
        .filter((provider) => (modelsByProvider.get(provider.id) ?? []).some((model) => model.enabled))
        .map((provider) => provider.id)
      const defaults = defaultModel.data ? { [defaultModel.data.providerID]: defaultModel.data.modelID } : {}
      return { data: { all, default: defaults, connected } }
    },
  }
}

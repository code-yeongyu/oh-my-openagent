import type { V2PluginContext } from "../context-types"

/**
 * `config.get()` in the 1.x shape `{ data: config }`. 2.x does not hand plugins the merged config,
 * so only what the host can report is filled in: the default model, as `provider/model`.
 */
export function createConfigNamespace(context: V2PluginContext) {
  return {
    get: async () => {
      const defaultModel = (await context.model.default()).data
      const config: Record<string, unknown> = defaultModel
        ? { model: `${defaultModel.providerID}/${defaultModel.modelID}` }
        : {}
      return { data: config }
    },
  }
}

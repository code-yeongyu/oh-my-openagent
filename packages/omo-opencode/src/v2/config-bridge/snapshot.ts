import type { V2PluginContext } from "../context-types"

/**
 * The 1.x config object the plugin's `config` hook expects to receive and mutate. 2.x does not hand
 * plugins the merged config, so the snapshot carries what the host can report (the default model)
 * and empty maps for the sections the hook fills in.
 */
export async function buildConfigSnapshot(context: V2PluginContext): Promise<Record<string, unknown>> {
  const defaultModel = (await context.model.default()).data
  return {
    ...(defaultModel ? { model: `${defaultModel.providerID}/${defaultModel.modelID}` } : {}),
    agent: {},
    command: {},
    mcp: {},
    provider: {},
  }
}

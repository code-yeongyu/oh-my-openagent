import type { PluginComponents } from "./plugin-components-loader"
import { setPluginHooksConfigs } from "../hooks/claude-code-hooks/config"
import { log } from "../shared"

export function applyHookConfig(params: {
  pluginComponents: PluginComponents;
  ctx: { directory: string };
}): void {
  const { pluginComponents, ctx } = params

  if (pluginComponents.hooksConfigs.length > 0) {
    log("[hook-config-handler] Merging plugin hooks configs", {
      count: pluginComponents.hooksConfigs.length,
      plugins: pluginComponents.plugins.map(p => p.name),
    })
  }

  setPluginHooksConfigs(ctx.directory, pluginComponents.hooksConfigs)
}

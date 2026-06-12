import type { PluginComponents } from "./plugin-components-loader"
import { setPluginHooksConfigs } from "../hooks/claude-code-hooks/config"
import { log } from "../shared"

export function applyHookConfig(params: {
  pluginComponents: PluginComponents;
}): void {
  const { pluginComponents } = params

  if (pluginComponents.hooksConfigs.length > 0) {
    log("[hook-config-handler] Merging plugin hooks configs", {
      count: pluginComponents.hooksConfigs.length,
      plugins: pluginComponents.plugins.map(p => p.name),
    })
  }

  // `loadClaudeHooksConfig` reads `pluginHooksState` keyed by
  // `process.cwd()`; the earlier wiring keyed the state by `ctx.directory`
  // (the plugin host's project directory), so any setup where the two
  // diverge — worktree, launcher chdir, dev sandbox — silently dropped
  // every plugin hook even though `applyHookConfig` ran. See #4001 / #4179.
  setPluginHooksConfigs(process.cwd(), pluginComponents.hooksConfigs)
}

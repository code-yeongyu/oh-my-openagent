import type { OhMyOpenCodeConfig } from "../config";
import { loadAllPluginComponents } from "../features/claude-code-plugin-loader";
import { addConfigLoadError, log } from "../shared";

export type PluginComponents = {
  commands: Record<string, unknown>;
  skills: Record<string, unknown>;
  agents: Record<string, unknown>;
  mcpServers: Record<string, unknown>;
  hooksConfigs: Array<{ hooks?: Record<string, unknown> }>;
  plugins: Array<{ name: string; version: string }>;
  errors: Array<{ pluginKey: string; installPath: string; error: string }>;
};

const EMPTY_PLUGIN_COMPONENTS: PluginComponents = {
  commands: {},
  skills: {},
  agents: {},
  mcpServers: {},
  hooksConfigs: [],
  plugins: [],
  errors: [],
};

export async function loadPluginComponents(params: {
  pluginConfig: OhMyOpenCodeConfig;
}): Promise<PluginComponents> {
  const pluginsEnabled = params.pluginConfig.claude_code?.plugins ?? true;
  if (!pluginsEnabled) {
    return EMPTY_PLUGIN_COMPONENTS;
  }

  const timeoutMs = params.pluginConfig.experimental?.plugin_load_timeout_ms ?? 10000;

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Plugin loading timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    const pluginComponents = (await Promise.race([
      loadAllPluginComponents({
        enabledPluginsOverride: params.pluginConfig.claude_code?.plugins_override,
      }),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    })) as PluginComponents;

    if (pluginComponents.plugins.length > 0) {
      log(`Loaded ${pluginComponents.plugins.length} Claude Code plugins`, {
        plugins: pluginComponents.plugins.map((p) => `${p.name}@${p.version}`),
      });
    }

    if (pluginComponents.errors.length > 0) {
      log(`Plugin load errors`, { errors: pluginComponents.errors });
    }

    return pluginComponents;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("[config-handler] Plugin loading failed", { error: errorMessage });
    addConfigLoadError({ path: "plugin-loading", error: errorMessage });
    return EMPTY_PLUGIN_COMPONENTS;
  }
}

import type { OhMyOpenCodeConfig } from "../config";
import { loadAllPluginComponents } from "@oh-my-opencode/claude-code-compat-core/claude-code-plugin-loader";
import type { PluginHooksConfig } from "../hooks/claude-code-hooks/types";
import { addConfigLoadError, log } from "../shared";
import {
  fingerprintClaudePluginRoots,
  getProcessConfigCacheEntry,
  setProcessConfigCacheEntry,
} from "../shared/process-config-cache";

export type PluginComponents = {
  commands: Record<string, unknown>;
  skills: Record<string, unknown>;
  agents: Record<string, unknown>;
  mcpServers: Record<string, unknown>;
  hooksConfigs: PluginHooksConfig[];
  plugins: Array<{ name: string; version: string }>;
  errors: Array<{ pluginKey: string; installPath: string; error: string }>;
  retryableLoadFailure?: true;
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

function buildPluginComponentsCacheKey(params: {
  pluginConfig: OhMyOpenCodeConfig;
}): string {
  return JSON.stringify({
    enabled: params.pluginConfig.claude_code?.plugins ?? true,
    override: params.pluginConfig.claude_code?.plugins_override ?? null,
    provider: params.pluginConfig.claude_code?.anthropic_provider ?? null,
    // Fingerprint the installation roots so installing/uninstalling a Claude
    // Code plugin invalidates the cache without a process restart.
    roots: fingerprintClaudePluginRoots(),
  });
}

/**
 * Test/telemetry seam: how many times the underlying plugin loader actually
 * ran in this process (local fix 28). Cache hits do not increment it.
 */
let pluginComponentsRealLoadCount = 0;

export function getPluginComponentsRealLoadCount(): number {
  return pluginComponentsRealLoadCount;
}

export async function loadPluginComponents(params: {
  pluginConfig: OhMyOpenCodeConfig;
}): Promise<PluginComponents> {
  const pluginsEnabled = params.pluginConfig.claude_code?.plugins ?? true;
  if (!pluginsEnabled) {
    return EMPTY_PLUGIN_COMPONENTS;
  }

  // Process-level reuse (local fix 28, first-message-drop F5c): plugin
  // components depend only on the global plugin config and the ~/.claude
  // plugin roots — identical for every chat folder — yet every folder rebuild
  // used to re-discover and re-import them all. Cached per process; a change
  // to the config slice or the plugin roots misses the key and recomputes.
  const cacheKey = buildPluginComponentsCacheKey(params);
  const cached = getProcessConfigCacheEntry("pluginComponents");
  if (cached && cached.key === cacheKey) {
    log("[plugin-components] reusing cached plugin components (process-level)", {
      plugins: ((cached.value as PluginComponents).plugins ?? []).map((p) => `${p.name}@${p.version}`),
    });
    return cached.value as PluginComponents;
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

    pluginComponentsRealLoadCount += 1;
    const pluginComponents = (await Promise.race([
      loadAllPluginComponents({
        enabledPluginsOverride: params.pluginConfig.claude_code?.plugins_override,
        anthropicProvider: params.pluginConfig.claude_code?.anthropic_provider,
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

    // Never cache a retryable failure: the next config pass must retry the load.
    if (pluginComponents.retryableLoadFailure !== true) {
      setProcessConfigCacheEntry("pluginComponents", { key: cacheKey, value: pluginComponents });
    }

    return pluginComponents;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("[config-handler] Plugin loading failed", { error: errorMessage });
    addConfigLoadError({ path: "plugin-loading", error: errorMessage });
    return { ...EMPTY_PLUGIN_COMPONENTS, retryableLoadFailure: true };
  }
}

import type { OhMyOpenCodeConfig } from "../config";
import { setAdditionalAllowedMcpEnvVars } from "../features/claude-code-mcp-loader";
import type { ModelCacheState } from "../plugin-state";
import { log } from "../shared";
import { applyAgentConfig } from "./agent-config-handler";
import { applyCommandConfig } from "./command-config-handler";
import { applyMcpConfig } from "./mcp-config-handler";
import { applyProviderConfig } from "./provider-config-handler";
import { loadPluginComponents } from "./plugin-components-loader";
import { applyToolConfig } from "./tool-config-handler";
import { clearFormatterCache } from "../tools/hashline-edit/formatter-trigger"
import type { createHostSkillConfigStore } from "../shared/host-skill-config"

export { resolveCategoryConfig } from "./category-config-resolver";

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: any };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
  hostSkillConfigStore: ReturnType<typeof createHostSkillConfigStore>;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState, hostSkillConfigStore } = deps;

  return async (config: Record<string, unknown>) => {
    const formatterConfig = config.formatter;

    hostSkillConfigStore.set(config.skills)
    setAdditionalAllowedMcpEnvVars(pluginConfig.mcp_env_allowlist ?? [])
    applyProviderConfig({ config, modelCacheState });
    clearFormatterCache()

    const pluginComponents = await loadPluginComponents({ pluginConfig });

    const agentResult = await applyAgentConfig({
      config,
      pluginConfig,
      ctx,
      pluginComponents,
    });

    applyToolConfig({ config, pluginConfig, agentResult });
    await applyMcpConfig({ config, pluginConfig, pluginComponents });
    await applyCommandConfig({ config, pluginConfig, ctx, pluginComponents });

    config.formatter = formatterConfig;

    log("[config-handler] config handler applied", {
      agentCount: Object.keys(agentResult).length,
      commandCount: Object.keys((config.command as Record<string, unknown>) ?? {})
        .length,
    });
  };
}

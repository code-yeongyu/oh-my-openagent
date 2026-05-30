import type { OhMyOpenCodeConfig } from "../config";
import { setAdditionalAllowedMcpEnvVars } from "../features/claude-code-mcp-loader";
import type { ModelCacheState } from "../plugin-state";
import { log } from "../shared";
import { applyAgentConfig } from "./agent-config-handler";
import { applyCommandConfig } from "./command-config-handler";
import { applyHookConfig } from "./hook-config-handler";
import { applyMcpConfig } from "./mcp-config-handler";
import { applyProviderConfig } from "./provider-config-handler";
import { loadPluginComponents } from "./plugin-components-loader";
import { applyToolConfig } from "./tool-config-handler";
import { clearFormatterCache } from "../tools/hashline-edit/formatter-trigger"
import { adaptHostSkillConfig } from "../shared/host-skill-config"
import type { SkillsConfig } from "../config/schema/skills"

export { resolveCategoryConfig } from "./category-config-resolver";

function collectTrustedVisionCapableModels(
  pluginConfig: OhMyOpenCodeConfig,
): string[] {
  const trusted: string[] = []
  const multimodalLookerOverride = pluginConfig.agents?.["multimodal-looker"]
  const configuredModel = multimodalLookerOverride?.model
  if (typeof configuredModel === "string" && configuredModel.includes("/")) {
    trusted.push(configuredModel)
  }
  return trusted
}

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: any };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
  hostSkillConfigRef?: { config: SkillsConfig | undefined };
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState } = deps;

  return async (config: Record<string, unknown>) => {
    const formatterConfig = config.formatter;

    setAdditionalAllowedMcpEnvVars(pluginConfig.mcp_env_allowlist ?? [])
    applyProviderConfig({
      config,
      modelCacheState,
      trustedVisionCapableModels: collectTrustedVisionCapableModels(pluginConfig),
    });
    clearFormatterCache()

    const pluginComponents = await loadPluginComponents({ pluginConfig });

    applyHookConfig({ pluginComponents, ctx });

    const agentResult = await applyAgentConfig({
      config,
      pluginConfig,
      ctx,
      pluginComponents,
    });

    applyToolConfig({ config, pluginConfig, agentResult });
    await applyMcpConfig({ config, pluginConfig, ctx, pluginComponents });
    await applyCommandConfig({ config, pluginConfig, ctx, pluginComponents });

    config.formatter = formatterConfig;

    if (deps.hostSkillConfigRef) {
      log("[config-handler] inspecting config.skills from OpenCode", {
        keys: typeof config.skills === "object" && config.skills !== null ? Object.keys(config.skills as object) : [],
        type: typeof config.skills,
        isArray: Array.isArray(config.skills),
        preview: typeof config.skills === "object" ? JSON.stringify(config.skills).slice(0, 500) : String(config.skills),
      })
      deps.hostSkillConfigRef.config = adaptHostSkillConfig(config.skills)
    }

    log("[config-handler] config handler applied", {
      agentCount: Object.keys(agentResult).length,
      commandCount: Object.keys((config.command as Record<string, unknown>) ?? {})
        .length,
    });
  };
}

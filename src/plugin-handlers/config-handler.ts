import type { OhMyOpenCodeConfig } from "../config";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";
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

export { resolveCategoryConfig } from "./category-config-resolver";

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: any };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
  /**
   * Late-bound accessor for the live `skillContext.mergedSkills` array.
   *
   * `createConfigHandler` is built inside `createManagers`, which runs before
   * `createTools` has produced the merged-skills array. The returned function
   * is invoked when OpenCode actually triggers the config hook (well after
   * `createTools` has resolved), so by passing a getter we can hand sibling
   * plugins' skills into the live skill registry without restructuring the
   * init pipeline. Leave undefined in tests that don't care about this path —
   * `applyCommandConfig` treats a missing ref as a no-op.
   */
  getMergedSkillsRef?: () => LoadedSkill[] | undefined;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState } = deps;

  return async (config: Record<string, unknown>) => {
    const formatterConfig = config.formatter;

    setAdditionalAllowedMcpEnvVars(pluginConfig.mcp_env_allowlist ?? [])
    applyProviderConfig({ config, modelCacheState });
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
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx,
      pluginComponents,
      mergedSkillsRef: deps.getMergedSkillsRef?.(),
    });

    config.formatter = formatterConfig;

    log("[config-handler] config handler applied", {
      agentCount: Object.keys(agentResult).length,
      commandCount: Object.keys((config.command as Record<string, unknown>) ?? {})
        .length,
    });
  };
}

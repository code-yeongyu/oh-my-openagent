import type { OhMyOpenCodeConfig } from "../config";
import { applyRuntimeSkillSourceConfig } from "../features/opencode-runtime-skills"
import {
  listProjectAgentProvenance,
  replaceProjectAgentProvenance,
} from "../features/team-mode/final-open-code-agent-registry";
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
import {
  clearRegisteredAgentNames,
  registerAgentName,
} from "../features/claude-code-session-state";
import { setDefaultAgentForSort } from "../shared/agent-sort-shim";
import { getConfiguredDefaultAgent } from "./agent-config-assembly";

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
  ctx: { directory: string; client?: unknown };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
  runtimeSkillSourceUrl?: string;
}

type AgentConfigSnapshot = {
  readonly cacheKey: string;
  readonly configuredDefaultAgent: string | undefined;
  readonly defaultAgent: unknown;
  readonly agents: Record<string, unknown>;
  readonly projectAgentNames: readonly string[];
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneConfigValue)
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]),
    )
  }

  return value
}

function cloneAgentConfig(agents: Record<string, unknown>): Record<string, unknown> {
  return cloneConfigValue(agents) as Record<string, unknown>
}

function createAgentConfigCacheKey(config: Record<string, unknown>): string {
  return JSON.stringify({
    agent: config.agent,
    default_agent: config.default_agent,
    model: config.model,
    skills: config.skills,
  })
}

function replayAgentConfigSideEffects(params: {
  agentResult: Record<string, unknown>;
  configuredDefaultAgent: string | undefined;
  defaultAgent: unknown;
}): void {
  if (params.configuredDefaultAgent && typeof params.defaultAgent === "string") {
    setDefaultAgentForSort(params.defaultAgent)
  }
  clearRegisteredAgentNames()
  for (const name of Object.keys(params.agentResult)) {
    registerAgentName(name)
  }
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState, runtimeSkillSourceUrl } = deps;
  let agentConfigSnapshot: AgentConfigSnapshot | undefined;

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
    const pluginComponentsLoadFailed = pluginComponents.retryableLoadFailure === true;

    applyHookConfig({ pluginComponents });

    const agentCacheKey = createAgentConfigCacheKey(config);
    let agentResult: Record<string, unknown>;
    if (!pluginComponentsLoadFailed && agentConfigSnapshot?.cacheKey === agentCacheKey) {
      config.agent = cloneAgentConfig(agentConfigSnapshot.agents);
      if (agentConfigSnapshot.defaultAgent !== undefined) {
        config.default_agent = agentConfigSnapshot.defaultAgent;
      }
      agentResult = config.agent as Record<string, unknown>;
      replaceProjectAgentProvenance(ctx.directory, agentConfigSnapshot.projectAgentNames);
      replayAgentConfigSideEffects({
        agentResult,
        configuredDefaultAgent: agentConfigSnapshot.configuredDefaultAgent,
        defaultAgent: config.default_agent,
      })
    } else {
      const configuredDefaultAgent = getConfiguredDefaultAgent(config);
      replaceProjectAgentProvenance(ctx.directory, []);
      agentResult = await applyAgentConfig({
        config,
        pluginConfig,
        ctx,
        pluginComponents,
      });
      const projectAgentNames = listProjectAgentProvenance(ctx.directory);
      agentConfigSnapshot = pluginComponentsLoadFailed
        ? undefined
        : {
            cacheKey: agentCacheKey,
            configuredDefaultAgent,
            defaultAgent: config.default_agent,
            agents: cloneAgentConfig(agentResult),
            projectAgentNames,
          };
    }

    applyToolConfig({ config, pluginConfig, agentResult });
    await applyMcpConfig({ config, pluginConfig, ctx, pluginComponents });
    await applyCommandConfig({ config, pluginConfig, ctx, pluginComponents });
    if (runtimeSkillSourceUrl) {
      applyRuntimeSkillSourceConfig({
        config,
        pluginConfig,
        sourceUrl: runtimeSkillSourceUrl,
      })
    }

    config.formatter = formatterConfig;

    log("[config-handler] config handler applied", {
      agentCount: Object.keys(agentResult).length,
      commandCount: Object.keys((config.command as Record<string, unknown>) ?? {})
        .length,
    });
  };
}

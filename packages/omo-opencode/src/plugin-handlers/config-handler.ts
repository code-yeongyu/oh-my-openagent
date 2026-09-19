import type { OhMyOpenCodeConfig } from "../config";
import { applyRuntimeSkillSourceConfig } from "../features/opencode-runtime-skills"
import { setAdditionalAllowedMcpEnvVars } from "../features/claude-code-mcp-loader";
import { applyOpenGatewayProviderConfig } from "../features/opengateway-provider";
import type { ModelCacheState } from "../plugin-state";
import { log } from "../shared";
import { AGENT_DISPLAY_NAMES, getAgentListDisplayName } from "../shared/agent-display-names";
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

function attachHiddenConfigKeyAliases(
  config: Record<string, unknown>,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agents = config.agent
  if (typeof agents !== "object" || agents === null) {
    return
  }

  const agentMap = agents as Record<string, unknown>
  const overrides = pluginConfig.agents as
    | Record<string, { displayName?: string } | undefined>
    | undefined
  const configKeys = new Set([
    ...Object.keys(AGENT_DISPLAY_NAMES),
    ...Object.keys(overrides ?? {}),
  ])

  for (const configKey of configKeys) {
    const displayName = getAgentListDisplayName(configKey, overrides)
    if (!displayName || displayName === configKey) {
      continue
    }

    const displayEntry = agentMap[displayName]
    if (typeof displayEntry !== "object" || displayEntry === null) {
      continue
    }

    agentMap[configKey] = {
      ...(displayEntry as Record<string, unknown>),
      hidden: true,
    }
    registerAgentName(configKey)
  }
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
    applyOpenGatewayProviderConfig(config);
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
      replayAgentConfigSideEffects({
        agentResult,
        configuredDefaultAgent: agentConfigSnapshot.configuredDefaultAgent,
        defaultAgent: config.default_agent,
      })
    } else {
      const configuredDefaultAgent = getConfiguredDefaultAgent(config);
      agentResult = await applyAgentConfig({
        config,
        pluginConfig,
        ctx,
        pluginComponents,
      });
      agentConfigSnapshot = pluginComponentsLoadFailed
        ? undefined
        : {
            cacheKey: agentCacheKey,
            configuredDefaultAgent,
            defaultAgent: config.default_agent,
            agents: cloneAgentConfig(agentResult),
          };
    }

    applyToolConfig({ config, pluginConfig, agentResult });
    attachHiddenConfigKeyAliases(config, pluginConfig);
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

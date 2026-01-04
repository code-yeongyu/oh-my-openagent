import { createBuiltinAgents } from "../agents";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "../features/claude-code-command-loader";
import { loadBuiltinCommands } from "../features/builtin-commands";
import {
  loadUserSkills,
  loadProjectSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
} from "../features/opencode-skill-loader";
import {
  loadUserAgents,
  loadProjectAgents,
} from "../features/claude-code-agent-loader";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { loadAllPluginComponents } from "../features/claude-code-plugin-loader";
import { createBuiltinMcps } from "../mcp";
import type { OhMyOpenCodeConfig } from "../config";
import { log } from "../shared";
import { migrateAgentConfig } from "../shared/permission-compat";
import { PLAN_SYSTEM_PROMPT, PLAN_PERMISSION } from "../agents/plan-prompt";
import type { ModelCacheState } from "../plugin-state";

export interface ConfigHandlerDeps {
  ctx: { directory: string };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState } = deps;

  return async (config: Record<string, unknown>) => {
    type ProviderConfig = {
      options?: { headers?: Record<string, string> };
      models?: Record<string, { limit?: { context?: number } }>;
    };
    const providers = config.provider as
      | Record<string, ProviderConfig>
      | undefined;

    const anthropicBeta =
      providers?.anthropic?.options?.headers?.["anthropic-beta"];
    modelCacheState.anthropicContext1MEnabled =
      anthropicBeta?.includes("context-1m") ?? false;

    if (providers) {
      for (const [providerID, providerConfig] of Object.entries(providers)) {
        const models = providerConfig?.models;
        if (models) {
          for (const [modelID, modelConfig] of Object.entries(models)) {
            const contextLimit = modelConfig?.limit?.context;
            if (contextLimit) {
              modelCacheState.modelContextLimitsCache.set(
                `${providerID}/${modelID}`,
                contextLimit
              );
            }
          }
        }
      }
    }

    const pluginComponents = (pluginConfig.claude_code?.plugins ?? true)
      ? await loadAllPluginComponents({
          enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
        })
      : {
          commands: {},
          skills: {},
          agents: {},
          mcpServers: {},
          hooksConfigs: [],
          plugins: [],
          errors: [],
        };

    if (pluginComponents.plugins.length > 0) {
      log(`Loaded ${pluginComponents.plugins.length} Claude Code plugins`, {
        plugins: pluginComponents.plugins.map((p) => `${p.name}@${p.version}`),
      });
    }

    if (pluginComponents.errors.length > 0) {
      log(`Plugin load errors`, { errors: pluginComponents.errors });
    }

    const builtinAgents = createBuiltinAgents(
      pluginConfig.disabled_agents,
      pluginConfig.agents,
      ctx.directory,
      config.model as string | undefined
    );

    const rawUserAgents = (pluginConfig.claude_code?.agents ?? true)
      ? loadUserAgents()
      : {};
    const rawProjectAgents = (pluginConfig.claude_code?.agents ?? true)
      ? loadProjectAgents()
      : {};
    const rawPluginAgents = pluginComponents.agents;

    const userAgents = Object.fromEntries(
      Object.entries(rawUserAgents).map(([k, v]) => [
        k,
        v ? migrateAgentConfig(v as Record<string, unknown>) : v,
      ])
    );
    const projectAgents = Object.fromEntries(
      Object.entries(rawProjectAgents).map(([k, v]) => [
        k,
        v ? migrateAgentConfig(v as Record<string, unknown>) : v,
      ])
    );
    const pluginAgents = Object.fromEntries(
      Object.entries(rawPluginAgents).map(([k, v]) => [
        k,
        v ? migrateAgentConfig(v as Record<string, unknown>) : v,
      ])
    );

    const isSisyphusEnabled = pluginConfig.sisyphus_agent?.disabled !== true;
    const builderEnabled =
      pluginConfig.sisyphus_agent?.default_builder_enabled ?? false;
    const plannerEnabled =
      pluginConfig.sisyphus_agent?.planner_enabled ?? true;
    const replacePlan = pluginConfig.sisyphus_agent?.replace_plan ?? true;

    type AgentConfig = Record<
      string,
      Record<string, unknown> | undefined
    > & {
      build?: Record<string, unknown>;
      plan?: Record<string, unknown>;
      explore?: { tools?: Record<string, unknown> };
      librarian?: { tools?: Record<string, unknown> };
      "multimodal-looker"?: { tools?: Record<string, unknown> };
    };
    const configAgent = config.agent as AgentConfig | undefined;

    if (isSisyphusEnabled && builtinAgents.Sisyphus) {
      (config as { default_agent?: string }).default_agent = "Sisyphus";

      const agentConfig: Record<string, unknown> = {
        Sisyphus: builtinAgents.Sisyphus,
      };

      if (builderEnabled) {
        const { name: _buildName, ...buildConfigWithoutName } =
          configAgent?.build ?? {};
        const migratedBuildConfig = migrateAgentConfig(
          buildConfigWithoutName as Record<string, unknown>
        );
        const openCodeBuilderOverride =
          pluginConfig.agents?.["OpenCode-Builder"];
        const openCodeBuilderBase = {
          ...migratedBuildConfig,
          description: `${configAgent?.build?.description ?? "Build agent"} (OpenCode default)`,
        };

        agentConfig["OpenCode-Builder"] = openCodeBuilderOverride
          ? { ...openCodeBuilderBase, ...openCodeBuilderOverride }
          : openCodeBuilderBase;
      }

      if (plannerEnabled) {
        const { name: _planName, ...planConfigWithoutName } =
          configAgent?.plan ?? {};
        const migratedPlanConfig = migrateAgentConfig(
          planConfigWithoutName as Record<string, unknown>
        );
        const plannerSisyphusOverride =
          pluginConfig.agents?.["Planner-Sisyphus"];
        const plannerSisyphusBase = {
          ...migratedPlanConfig,
          mode: "primary",
          prompt: PLAN_SYSTEM_PROMPT,
          permission: PLAN_PERMISSION,
          description: `${configAgent?.plan?.description ?? "Plan agent"} (OhMyOpenCode version)`,
          color: (configAgent?.plan?.color as string) ?? "#6495ED",
        };

        agentConfig["Planner-Sisyphus"] = plannerSisyphusOverride
          ? { ...plannerSisyphusBase, ...plannerSisyphusOverride }
          : plannerSisyphusBase;
      }

    const filteredConfigAgents = configAgent
      ? Object.fromEntries(
          Object.entries(configAgent)
            .filter(([key]) => {
              if (key === "build") return false;
              if (key === "plan" && replacePlan) return false;
              return true;
            })
            .map(([key, value]) => [
              key,
              value ? migrateAgentConfig(value as Record<string, unknown>) : value,
            ])
        )
      : {};

      const migratedBuild = configAgent?.build
        ? migrateAgentConfig(configAgent.build as Record<string, unknown>)
        : {};
      const migratedPlan = configAgent?.plan
        ? migrateAgentConfig(configAgent.plan as Record<string, unknown>)
        : {};

      const planDemoteConfig = replacePlan
        ? { disable: true }
        : undefined;
      
      log("DEBUG plan demotion", {
        replacePlan,
        plannerEnabled,
        hasPlannerSisyphus: !!agentConfig["Planner-Sisyphus"],
        planDemoteConfig,
        configAgentPlan: configAgent?.plan,
      });

      config.agent = {
        ...agentConfig,
        ...Object.fromEntries(
          Object.entries(builtinAgents).filter(([k]) => k !== "Sisyphus")
        ),
        ...userAgents,
        ...projectAgents,
        ...pluginAgents,
        ...filteredConfigAgents,
        build: { ...migratedBuild, mode: "subagent", hidden: true },
        ...(planDemoteConfig ? { plan: planDemoteConfig } : {}),
      };
    } else {
      config.agent = {
        ...builtinAgents,
        ...userAgents,
        ...projectAgents,
        ...pluginAgents,
        ...configAgent,
      };
    }

    const agentResult = config.agent as AgentConfig;

    config.tools = {
      ...(config.tools as Record<string, unknown>),
      "grep_app_*": false,
    };

    if (agentResult.explore) {
      agentResult.explore.tools = {
        ...agentResult.explore.tools,
        call_omo_agent: false,
      };
    }
    if (agentResult.librarian) {
      agentResult.librarian.tools = {
        ...agentResult.librarian.tools,
        call_omo_agent: false,
        "grep_app_*": true,
      };
    }
    if (agentResult["multimodal-looker"]) {
      agentResult["multimodal-looker"].tools = {
        ...agentResult["multimodal-looker"].tools,
        task: false,
        call_omo_agent: false,
        look_at: false,
      };
    }

    config.permission = {
      ...(config.permission as Record<string, unknown>),
      webfetch: "allow",
      external_directory: "allow",
    };

    const mcpResult = (pluginConfig.claude_code?.mcp ?? true)
      ? await loadMcpConfigs()
      : { servers: {} };

    config.mcp = {
      ...(config.mcp as Record<string, unknown>),
      ...createBuiltinMcps(pluginConfig.disabled_mcps),
      ...mcpResult.servers,
      ...pluginComponents.mcpServers,
    };

    const builtinCommands = loadBuiltinCommands(pluginConfig.disabled_commands);
    const userCommands = (pluginConfig.claude_code?.commands ?? true)
      ? loadUserCommands()
      : {};
    const opencodeGlobalCommands = loadOpencodeGlobalCommands();
    const systemCommands = (config.command as Record<string, unknown>) ?? {};
    const projectCommands = (pluginConfig.claude_code?.commands ?? true)
      ? loadProjectCommands()
      : {};
    const opencodeProjectCommands = loadOpencodeProjectCommands();

    const userSkills = (pluginConfig.claude_code?.skills ?? true)
      ? loadUserSkills()
      : {};
    const projectSkills = (pluginConfig.claude_code?.skills ?? true)
      ? loadProjectSkills()
      : {};
    const opencodeGlobalSkills = loadOpencodeGlobalSkills();
    const opencodeProjectSkills = loadOpencodeProjectSkills();

    config.command = {
      ...builtinCommands,
      ...userCommands,
      ...userSkills,
      ...opencodeGlobalCommands,
      ...opencodeGlobalSkills,
      ...systemCommands,
      ...projectCommands,
      ...projectSkills,
      ...opencodeProjectCommands,
      ...opencodeProjectSkills,
      ...pluginComponents.commands,
      ...pluginComponents.skills,
    };
  };
}

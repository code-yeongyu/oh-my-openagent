import { createBuiltinAgents } from "../agents";
import { createSisyphusJuniorAgentWithOverrides } from "../agents/sisyphus-junior";
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
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
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
import { getOpenCodeConfigPaths } from "../shared/opencode-config-dir";
import { migrateAgentConfig } from "../shared/permission-compat";
import { AGENT_NAME_MAP } from "../shared/migration";
import { PROMETHEUS_SYSTEM_PROMPT, PROMETHEUS_PERMISSION } from "../agents/prometheus-prompt";
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants";
import type { ModelCacheState } from "../plugin-state";
import type { CategoryConfig } from "../config/schema";

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: any };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
}

export function resolveCategoryConfig(
  categoryName: string,
  userCategories?: Record<string, CategoryConfig>
): CategoryConfig | undefined {
  return userCategories?.[categoryName] ?? DEFAULT_CATEGORIES[categoryName];
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

    if (!(config.model as string | undefined)?.trim()) {
      const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
      throw new Error(
        'oh-my-opencode requires a default model.\n\n' +
        `Add this to ${paths.configJsonc}:\n\n` +
        '  "model": "anthropic/claude-sonnet-4-5"\n\n' +
        '(Replace with your preferred provider/model)'
      )
    }

    // Migrate disabled_agents from old names to new names
    const migratedDisabledAgents = (pluginConfig.disabled_agents ?? []).map(agent => {
      return AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent
    }) as typeof pluginConfig.disabled_agents

    const includeClaudeSkillsForAwareness = pluginConfig.claude_code?.skills ?? true;
    const [
      discoveredUserSkills,
      discoveredProjectSkills,
      discoveredOpencodeGlobalSkills,
      discoveredOpencodeProjectSkills,
    ] = await Promise.all([
      includeClaudeSkillsForAwareness ? discoverUserClaudeSkills() : Promise.resolve([]),
      includeClaudeSkillsForAwareness ? discoverProjectClaudeSkills() : Promise.resolve([]),
      discoverOpencodeGlobalSkills(),
      discoverOpencodeProjectSkills(),
    ]);

    const allDiscoveredSkills = [
      ...discoveredOpencodeProjectSkills,
      ...discoveredProjectSkills,
      ...discoveredOpencodeGlobalSkills,
      ...discoveredUserSkills,
    ];

    const builtinAgents = await createBuiltinAgents(
      migratedDisabledAgents,
      pluginConfig.agents,
      ctx.directory,
      config.model as string | undefined,
      pluginConfig.categories,
      pluginConfig.git_master,
      allDiscoveredSkills,
      ctx.client
    );

    // Claude Code agents: Do NOT apply permission migration
    // Claude Code uses whitelist-based tools format which is semantically different
    // from OpenCode's denylist-based permission system
    const userAgents = (pluginConfig.claude_code?.agents ?? true)
      ? loadUserAgents()
      : {};
    const projectAgents = (pluginConfig.claude_code?.agents ?? true)
      ? loadProjectAgents()
      : {};

    // Plugin agents: Apply permission migration for compatibility
    const rawPluginAgents = pluginComponents.agents;
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
      Atlas?: { tools?: Record<string, unknown> };
      Sisyphus?: { tools?: Record<string, unknown> };
    };
    const configAgent = config.agent as AgentConfig | undefined;

    if (isSisyphusEnabled && builtinAgents.Sisyphus) {
      (config as { default_agent?: string }).default_agent = "Sisyphus";

      const agentConfig: Record<string, unknown> = {
        Sisyphus: builtinAgents.Sisyphus,
      };

      agentConfig["Sisyphus-Junior"] = createSisyphusJuniorAgentWithOverrides(
        pluginConfig.agents?.["Sisyphus-Junior"],
        config.model as string | undefined
      );

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
        const { name: _planName, mode: _planMode, ...planConfigWithoutName } =
          configAgent?.plan ?? {};
        const migratedPlanConfig = migrateAgentConfig(
          planConfigWithoutName as Record<string, unknown>
        );
        const prometheusOverride =
          pluginConfig.agents?.["Prometheus (Planner)"] as
            | (Record<string, unknown> & { category?: string; model?: string })
            | undefined;
        const defaultModel = config.model as string | undefined;

        // Resolve full category config (model, temperature, top_p, tools, etc.)
        // Apply all category properties when category is specified, but explicit
        // overrides (model, temperature, etc.) will take precedence during merge
        const categoryConfig = prometheusOverride?.category
          ? resolveCategoryConfig(
              prometheusOverride.category,
              pluginConfig.categories
            )
          : undefined;

        // Model resolution: explicit override → category config → OpenCode default
        // No hardcoded fallback - OpenCode config.model is the terminal fallback
        const resolvedModel = prometheusOverride?.model ?? categoryConfig?.model ?? defaultModel;

        const prometheusBase = {
          // Only include model if one was resolved - let OpenCode apply its own default if none
          ...(resolvedModel ? { model: resolvedModel } : {}),
          mode: "primary" as const,
          prompt: PROMETHEUS_SYSTEM_PROMPT,
          permission: PROMETHEUS_PERMISSION,
          description: `${configAgent?.plan?.description ?? "Plan agent"} (Prometheus - OhMyOpenCode)`,
          color: (configAgent?.plan?.color as string) ?? "#FF6347",
          // Apply category properties (temperature, top_p, tools, etc.)
          ...(categoryConfig?.temperature !== undefined
            ? { temperature: categoryConfig.temperature }
            : {}),
          ...(categoryConfig?.top_p !== undefined
            ? { top_p: categoryConfig.top_p }
            : {}),
          ...(categoryConfig?.maxTokens !== undefined
            ? { maxTokens: categoryConfig.maxTokens }
            : {}),
          ...(categoryConfig?.tools ? { tools: categoryConfig.tools } : {}),
          ...(categoryConfig?.thinking ? { thinking: categoryConfig.thinking } : {}),
          ...(categoryConfig?.reasoningEffort !== undefined
            ? { reasoningEffort: categoryConfig.reasoningEffort }
            : {}),
          ...(categoryConfig?.textVerbosity !== undefined
            ? { textVerbosity: categoryConfig.textVerbosity }
            : {}),
        };

        agentConfig["Prometheus (Planner)"] = prometheusOverride
          ? { ...prometheusBase, ...prometheusOverride }
          : prometheusBase;
      }

    const filteredConfigAgents = configAgent
      ? Object.fromEntries(
          Object.entries(configAgent)
            .filter(([key]) => {
              if (key === "build") return false;
              if (key === "plan" && replacePlan) return false;
              // Filter out agents that oh-my-opencode provides to prevent
              // OpenCode defaults from overwriting user config in oh-my-opencode.json
              // See: https://github.com/code-yeongyu/oh-my-opencode/issues/472
              if (key in builtinAgents) return false;
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

      const planDemoteConfig = replacePlan
        ? { mode: "subagent" as const }
        : undefined;

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
      LspHover: false,
      LspCodeActions: false,
      LspCodeActionResolve: false,
    };

    type AgentWithPermission = { permission?: Record<string, unknown> };
    
    if (agentResult.librarian) {
      const agent = agentResult.librarian as AgentWithPermission;
      agent.permission = { ...agent.permission, "grep_app_*": "allow" };
    }
    if (agentResult["multimodal-looker"]) {
      const agent = agentResult["multimodal-looker"] as AgentWithPermission;
      agent.permission = { ...agent.permission, task: "deny", look_at: "deny" };
    }
    if (agentResult["Atlas"]) {
      const agent = agentResult["Atlas"] as AgentWithPermission;
      agent.permission = { ...agent.permission, task: "deny", call_omo_agent: "deny", delegate_task: "allow" };
    }
    if (agentResult.Sisyphus) {
      const agent = agentResult.Sisyphus as AgentWithPermission;
      agent.permission = { ...agent.permission, call_omo_agent: "deny", delegate_task: "allow", question: "allow" };
    }
    if (agentResult["Prometheus (Planner)"]) {
      const agent = agentResult["Prometheus (Planner)"] as AgentWithPermission;
      agent.permission = { ...agent.permission, call_omo_agent: "deny", delegate_task: "allow", question: "allow" };
    }
    if (agentResult["Sisyphus-Junior"]) {
      const agent = agentResult["Sisyphus-Junior"] as AgentWithPermission;
      agent.permission = { ...agent.permission, delegate_task: "allow" };
    }

    config.permission = {
      ...(config.permission as Record<string, unknown>),
      webfetch: "allow",
      external_directory: "allow",
      delegate_task: "deny",
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
    const systemCommands = (config.command as Record<string, unknown>) ?? {};

    // Parallel loading of all commands and skills for faster startup
    const includeClaudeCommands = pluginConfig.claude_code?.commands ?? true;
    const includeClaudeSkills = pluginConfig.claude_code?.skills ?? true;

    const [
      userCommands,
      projectCommands,
      opencodeGlobalCommands,
      opencodeProjectCommands,
      userSkills,
      projectSkills,
      opencodeGlobalSkills,
      opencodeProjectSkills,
    ] = await Promise.all([
      includeClaudeCommands ? loadUserCommands() : Promise.resolve({}),
      includeClaudeCommands ? loadProjectCommands() : Promise.resolve({}),
      loadOpencodeGlobalCommands(),
      loadOpencodeProjectCommands(),
      includeClaudeSkills ? loadUserSkills() : Promise.resolve({}),
      includeClaudeSkills ? loadProjectSkills() : Promise.resolve({}),
      loadOpencodeGlobalSkills(),
      loadOpencodeProjectSkills(),
    ]);

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

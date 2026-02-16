import { createBuiltinAgents } from "../agents";
import { createSisyphusJuniorAgentWithOverrides } from "../agents/sisyphus-junior";
import type { OhMyOpenCodeConfig } from "../config";
import { log, migrateAgentConfig } from "../shared";
import { AGENT_NAME_MAP } from "../shared/migration";
import {
  discoverConfigSourceSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
} from "../features/opencode-skill-loader";
import { loadProjectAgents, loadUserAgents } from "../features/claude-code-agent-loader";
import type { PluginComponents } from "./plugin-components-loader";
import { reorderAgentsByPriority } from "./agent-priority-order";
import { buildPrometheusAgentConfig } from "./prometheus-agent-config-builder";
import { buildPlanDemoteConfig } from "./plan-model-inheritance";

type AgentConfigRecord = Record<string, Record<string, unknown> | undefined> & {
  build?: Record<string, unknown>;
  plan?: Record<string, unknown>;
};

export async function applyAgentConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string; client?: any };
  pluginComponents: PluginComponents;
}): Promise<Record<string, unknown>> {
  const migratedDisabledAgents = (params.pluginConfig.disabled_agents ?? []).map(
    (agent) => {
      return AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent;
    },
  ) as typeof params.pluginConfig.disabled_agents;

  const includeClaudeSkillsForAwareness = params.pluginConfig.claude_code?.skills ?? true;
  const [
    discoveredConfigSourceSkills,
    discoveredUserSkills,
    discoveredProjectSkills,
    discoveredOpencodeGlobalSkills,
    discoveredOpencodeProjectSkills,
  ] = await Promise.all([
    discoverConfigSourceSkills({
      config: params.pluginConfig.skills,
      configDir: params.ctx.directory,
    }),
    includeClaudeSkillsForAwareness ? discoverUserClaudeSkills() : Promise.resolve([]),
    includeClaudeSkillsForAwareness
       ? discoverProjectClaudeSkills(params.ctx.directory)
       : Promise.resolve([]),
    discoverOpencodeGlobalSkills(),
    discoverOpencodeProjectSkills(params.ctx.directory),
  ]);

  const allDiscoveredSkills = [
    ...discoveredConfigSourceSkills,
    ...discoveredOpencodeProjectSkills,
    ...discoveredProjectSkills,
    ...discoveredOpencodeGlobalSkills,
    ...discoveredUserSkills,
  ];

  const browserProvider =
    params.pluginConfig.browser_automation_engine?.provider ?? "playwright";
  const currentModel = params.config.model as string | undefined;
  const disabledSkills = new Set<string>(params.pluginConfig.disabled_skills ?? []);
  const useTaskSystem = params.pluginConfig.experimental?.task_system ?? false;

  const builtinAgents = await createBuiltinAgents(
    migratedDisabledAgents,
    params.pluginConfig.agents,
    params.ctx.directory,
    undefined,
    params.pluginConfig.categories,
    params.pluginConfig.git_master,
    allDiscoveredSkills,
    params.ctx.client,
    browserProvider,
    currentModel,
    disabledSkills,
    useTaskSystem,
  );

  const includeClaudeAgents = params.pluginConfig.claude_code?.agents ?? true;
  const userAgents = includeClaudeAgents ? loadUserAgents() : {};
  const projectAgents = includeClaudeAgents ? loadProjectAgents(params.ctx.directory) : {};

  const rawPluginAgents = params.pluginComponents.agents;
  const pluginAgents = Object.fromEntries(
    Object.entries(rawPluginAgents).map(([key, value]) => [
      key,
      value ? migrateAgentConfig(value as Record<string, unknown>) : value,
    ]),
  );

  const isSisyphusEnabled = params.pluginConfig.sisyphus_agent?.disabled !== true;
  const builderEnabled =
    params.pluginConfig.sisyphus_agent?.default_builder_enabled ?? false;
  const plannerEnabled = params.pluginConfig.sisyphus_agent?.planner_enabled ?? true;
  const replacePlan = params.pluginConfig.sisyphus_agent?.replace_plan ?? true;
  const shouldDemotePlan = plannerEnabled && replacePlan;

  const configAgent = params.config.agent as AgentConfigRecord | undefined;

  if (isSisyphusEnabled && builtinAgents.sisyphus) {
    (params.config as { default_agent?: string }).default_agent = "sisyphus";

    const agentConfig: Record<string, unknown> = {
      sisyphus: builtinAgents.sisyphus,
    };

    agentConfig["sisyphus-junior"] = createSisyphusJuniorAgentWithOverrides(
      params.pluginConfig.agents?.["sisyphus-junior"],
      undefined,
      useTaskSystem,
    );

    if (builderEnabled) {
      const { name: _buildName, ...buildConfigWithoutName } =
        configAgent?.build ?? {};
      const migratedBuildConfig = migrateAgentConfig(
        buildConfigWithoutName as Record<string, unknown>,
      );
      const override = params.pluginConfig.agents?.["OpenCode-Builder"];
      const base = {
        ...migratedBuildConfig,
        description: `${(configAgent?.build?.description as string) ?? "Build agent"} (OpenCode default)`,
      };
      agentConfig["OpenCode-Builder"] = override ? { ...base, ...override } : base;
    }

    if (plannerEnabled) {
      const prometheusOverride = params.pluginConfig.agents?.["prometheus"] as
        | (Record<string, unknown> & { prompt_append?: string })
        | undefined;

      agentConfig["prometheus"] = await buildPrometheusAgentConfig({
        configAgentPlan: configAgent?.plan,
        pluginPrometheusOverride: prometheusOverride,
        userCategories: params.pluginConfig.categories,
        currentModel,
      });
    }

    const filteredConfigAgents = configAgent
      ? Object.fromEntries(
          Object.entries(configAgent)
            .filter(([key]) => {
              if (key === "build") return false;
              if (key === "plan" && shouldDemotePlan) return false;
              if (key in builtinAgents) return false;
              return true;
            })
            .map(([key, value]) => [
              key,
              value ? migrateAgentConfig(value as Record<string, unknown>) : value,
            ]),
        )
      : {};

    const migratedBuild = configAgent?.build
      ? migrateAgentConfig(configAgent.build as Record<string, unknown>)
      : {};

    const planDemoteConfig = shouldDemotePlan
      ? buildPlanDemoteConfig(
          agentConfig["prometheus"] as Record<string, unknown> | undefined,
          params.pluginConfig.agents?.plan as Record<string, unknown> | undefined,
        )
      : undefined;

    params.config.agent = {
      ...agentConfig,
      ...Object.fromEntries(
        Object.entries(builtinAgents).filter(([key]) => key !== "sisyphus"),
      ),
      ...userAgents,
      ...projectAgents,
      ...pluginAgents,
      ...filteredConfigAgents,
      build: { ...migratedBuild, mode: "subagent", hidden: true },
      ...(planDemoteConfig ? { plan: planDemoteConfig } : {}),
    };
  } else {
    params.config.agent = {
      ...builtinAgents,
      ...userAgents,
      ...projectAgents,
      ...pluginAgents,
      ...configAgent,
    };
  }

  if (params.config.agent) {
    params.config.agent = reorderAgentsByPriority(
      params.config.agent as Record<string, unknown>,
    );
  }

  const agentResult = params.config.agent as Record<string, unknown>;
  log("[config-handler] agents loaded", { agentKeys: Object.keys(agentResult) });
  return agentResult;
}

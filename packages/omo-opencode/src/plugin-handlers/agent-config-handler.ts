import { createBuiltinAgents } from "../agents";
import type { OhMyOpenCodeConfig } from "../config";
import { replaceProjectAgentProvenance } from "../features/team-mode/final-open-code-agent-registry";
import { collectDisabledSkillAliases } from "../plugin/skill-context";
import { isTaskSystemEnabled } from "../shared";
import { getAgentListDisplayName } from "../shared/agent-display-names";
import { AGENT_NAME_MAP } from "../shared/migration";
import { assembleAgentConfig } from "./agent-config-assembly";
import { finalizeAgentConfig } from "./agent-config-finalizer";
import { discoverAgentSkills } from "./agent-skill-discovery";
import { loadAgentSources } from "./agent-source-loader";
import type { AgentSources, ApplyAgentConfigParams } from "./agent-config-types";

function collectProjectAgentNames(
  sources: AgentSources,
  pluginConfig: OhMyOpenCodeConfig,
  finalAgents: Record<string, unknown>,
): readonly string[] {
  const runtimeName = (sourceName: string) =>
    getAgentListDisplayName(sourceName, pluginConfig.agents);
  const laterSourceNames = new Set([
    ...Object.keys(sources.agentDefinitionAgents),
    ...Object.keys(sources.opencodeConfigAgents),
  ].map(runtimeName));

  return [...new Set(
    Object.entries(sources.opencodeProjectAgents)
      .filter(([, config]) => config !== undefined)
      .map(([name]) => runtimeName(name))
      .filter((name) => Object.hasOwn(finalAgents, name) && !laterSourceNames.has(name)),
  )];
}

export async function applyAgentConfig(
  params: ApplyAgentConfigParams,
): Promise<Record<string, unknown>> {
  const migratedDisabledAgents = (params.pluginConfig.disabled_agents ?? []).map(
    (agent: string) => AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent,
  ) as typeof params.pluginConfig.disabled_agents;
  const allDiscoveredSkills = await discoverAgentSkills(params);
  const sources = loadAgentSources(params);
  const browserProvider =
    params.pluginConfig.browser_automation_engine?.provider ?? "playwright";
  const currentModel = params.config.model as string | undefined;
  const disabledSkills = collectDisabledSkillAliases(params.pluginConfig);
  const useTaskSystem = isTaskSystemEnabled(params.pluginConfig);
  const disableOmoEnv = params.pluginConfig.experimental?.disable_omo_env ?? false;
  const builtinAgents = await createBuiltinAgents(
    migratedDisabledAgents,
    params.pluginConfig.agents,
    params.ctx.directory,
    currentModel,
    params.pluginConfig.categories,
    params.pluginConfig.git_master,
    allDiscoveredSkills,
    sources.customAgentSummaries,
    browserProvider,
    currentModel,
    disabledSkills,
    useTaskSystem,
    disableOmoEnv,
    params.pluginConfig.team_mode?.enabled ?? false,
  );
  const disabledAgentNames = new Set(
    (migratedDisabledAgents ?? []).map((agent: string) => agent.toLowerCase()),
  );
  const { configuredDefaultAgent } = await assembleAgentConfig({
    config: params.config,
    pluginConfig: params.pluginConfig,
    builtinAgents,
    sources,
    currentModel,
    useTaskSystem,
    disabledAgentNames,
  });

  const agents = finalizeAgentConfig({
    config: params.config,
    pluginConfig: params.pluginConfig,
    configuredDefaultAgent,
  });
  replaceProjectAgentProvenance(
    params.ctx.directory,
    collectProjectAgentNames(sources, params.pluginConfig, agents),
  );
  return agents;
}

import { createBuiltinAgents } from "../agents";
import type { OhMyOpenCodeConfig } from "../config";
import { replaceProjectAgentProvenance } from "../features/team-mode/final-open-code-agent-registry";
import { collectDisabledSkillAliases } from "../plugin/skill-context";
import { isTaskSystemEnabled } from "../shared";
import { migrateDisabledAgents } from "../shared/disabled-agents";
import { getAgentListDisplayName } from "../shared/agent-display-names";
import { assembleAgentConfig } from "./agent-config-assembly";
import { finalizeAgentConfig } from "./agent-config-finalizer";
import { discoverAgentSkills } from "./agent-skill-discovery";
import { loadAgentSources } from "./agent-source-loader";
import type { AgentSources, ApplyAgentConfigParams } from "./agent-config-types";
import { createProtectedAgentNameSet, filterProtectedAgentOverrides } from "./agent-override-protection";

function collectProjectAgentNames(
  sources: AgentSources,
  pluginConfig: OhMyOpenCodeConfig,
  finalAgents: Record<string, unknown>,
  disabledAgentNames: ReadonlySet<string>,
  builtinAgents: Record<string, unknown>,
): readonly string[] {
  const runtimeName = (name: string) => getAgentListDisplayName(name, pluginConfig.agents);
  const laterNames = new Set([
    ...Object.keys(sources.agentDefinitionAgents),
    ...Object.keys(sources.opencodeConfigAgents),
  ].map(runtimeName));
  const protectedNames = Object.keys(builtinAgents);
  if (pluginConfig.sisyphus_agent?.disabled !== true && builtinAgents.sisyphus) {
    protectedNames.push("sisyphus", "sisyphus-junior");
    if (pluginConfig.sisyphus_agent?.planner_enabled ?? true) protectedNames.push("prometheus");
    if (pluginConfig.sisyphus_agent?.default_builder_enabled ?? false) protectedNames.push("OpenCode-Builder");
  }
  const projectAgents = filterProtectedAgentOverrides(
    Object.fromEntries(Object.entries(sources.opencodeProjectAgents)
      .filter(([name]) => !disabledAgentNames.has(name.toLowerCase()))),
    createProtectedAgentNameSet(protectedNames),
  );
  return [...new Set(Object.entries(projectAgents)
    .filter(([, config]) => config !== undefined)
    .map(([name]) => runtimeName(name))
    .filter((name) => Object.hasOwn(finalAgents, name) && !laterNames.has(name)))];
}

export async function applyAgentConfig(
  params: ApplyAgentConfigParams,
): Promise<Record<string, unknown>> {
  const migratedDisabledAgents = migrateDisabledAgents(
    params.pluginConfig.disabled_agents,
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
  replaceProjectAgentProvenance(params.ctx.directory, collectProjectAgentNames(
    sources, params.pluginConfig, agents, disabledAgentNames, builtinAgents,
  ));
  return agents;
}

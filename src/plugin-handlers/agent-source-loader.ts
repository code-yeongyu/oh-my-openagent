import {
  loadAgentDefinitions,
  loadOpencodeGlobalAgents,
  loadOpencodeProjectAgents,
  loadProjectAgents,
  loadUserAgents,
  readOpencodeConfigAgents,
} from "../features/claude-code-agent-loader";
import { log, migrateAgentConfig } from "../shared";
import type {
  AgentConfigRecord,
  AgentSourceMap,
  AgentSources,
  ApplyAgentConfigParams,
} from "./agent-config-types";

function migratePluginAgents(rawPluginAgents: Record<string, unknown>): AgentSourceMap {
  const migratedAgents: AgentSourceMap = {};
  for (const [key, value] of Object.entries(rawPluginAgents)) {
    if (!value) {
      migratedAgents[key] = undefined;
      continue;
    }
    const migrated = migrateAgentConfig(value as Record<string, unknown>);
    if (!migrated.mode) migrated.mode = "subagent";
    migratedAgents[key] = migrated;
  }
  return migratedAgents;
}

function summarizeCustomAgents(
  sources: Omit<AgentSources, "customAgentSummaries">,
): Array<{ name: string; description: string }> {
  return [
    ...Object.entries(sources.configAgent ?? {}),
    ...Object.entries(sources.userAgents),
    ...Object.entries(sources.projectAgents),
    ...Object.entries(sources.opencodeGlobalAgents),
    ...Object.entries(sources.opencodeProjectAgents),
    ...Object.entries(sources.pluginAgents).filter(([, config]) => config !== undefined),
    ...Object.entries(sources.agentDefinitionAgents),
    ...Object.entries(sources.opencodeConfigAgents),
  ]
    .filter(([, config]) => config != null)
    .map(([name, config]) => ({
      name,
      description:
        typeof (config as Record<string, unknown>).description === "string"
          ? ((config as Record<string, unknown>).description as string)
          : "",
    }));
}

export function loadAgentSources(params: ApplyAgentConfigParams): AgentSources {
  const includeClaudeAgents = params.pluginConfig.claude_code?.agents ?? true;
  const anthropicProvider = params.pluginConfig.claude_code?.anthropic_provider;
  const userAgents = includeClaudeAgents ? loadUserAgents(anthropicProvider) : {};
  const projectAgents = includeClaudeAgents
    ? loadProjectAgents(params.ctx.directory, anthropicProvider)
    : {};
  const opencodeGlobalAgents = loadOpencodeGlobalAgents();
  const opencodeProjectAgents = loadOpencodeProjectAgents(params.ctx.directory);
  const pluginAgents = migratePluginAgents(params.pluginComponents.agents);
  const agentDefinitionAgents = params.pluginConfig.agent_definitions
    ? loadAgentDefinitions(
        params.pluginConfig.agent_definitions,
        "definition-file",
        anthropicProvider,
      )
    : {};
  const opencodeConfigAgents = readOpencodeConfigAgents(params.ctx.directory);
  const configAgent = params.config.agent as AgentConfigRecord | undefined;
  const sourceCounts = {
    user: Object.keys(userAgents).length,
    project: Object.keys(projectAgents).length,
    opencodeGlobal: Object.keys(opencodeGlobalAgents).length,
    opencodeProject: Object.keys(opencodeProjectAgents).length,
    plugin: Object.keys(pluginAgents).length,
    agentDefinitions: Object.keys(agentDefinitionAgents).length,
    opencodeConfig: Object.keys(opencodeConfigAgents).length,
    config: Object.keys(configAgent ?? {}).length,
  };
  const sources = {
    userAgents,
    projectAgents,
    opencodeGlobalAgents,
    opencodeProjectAgents,
    pluginAgents,
    agentDefinitionAgents,
    opencodeConfigAgents,
    configAgent,
  };

  log("[agent-source-loader] Agent sources loaded", sourceCounts);

  return {
    ...sources,
    customAgentSummaries: summarizeCustomAgents(sources),
  };
}

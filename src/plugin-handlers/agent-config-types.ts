import type { OhMyOpenCodeConfig } from "../config";
import type { PluginComponents } from "./plugin-components-loader";

export type AgentConfigRecord = Record<string, Record<string, unknown> | undefined> & {
  build?: Record<string, unknown>;
  plan?: Record<string, unknown>;
};

export type ApplyAgentConfigParams = {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string; client?: unknown };
  pluginComponents: PluginComponents;
};

export type AgentSourceMap = Record<string, Record<string, unknown> | undefined>;

export type AgentSources = {
  userAgents: AgentSourceMap;
  projectAgents: AgentSourceMap;
  opencodeGlobalAgents: AgentSourceMap;
  opencodeProjectAgents: AgentSourceMap;
  pluginAgents: AgentSourceMap;
  agentDefinitionAgents: AgentSourceMap;
  opencodeConfigAgents: AgentSourceMap;
  configAgent: AgentConfigRecord | undefined;
  customAgentSummaries: Array<{ name: string; description: string }>;
};

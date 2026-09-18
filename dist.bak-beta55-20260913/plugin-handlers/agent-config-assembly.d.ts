import type { AgentConfig } from "@opencode-ai/sdk";
import type { OhMyOpenCodeConfig } from "../config";
import type { AgentSources } from "./agent-config-types";
type BuiltinAgentMap = Record<string, AgentConfig | undefined>;
type AssembleAgentConfigParams = {
    config: Record<string, unknown>;
    pluginConfig: OhMyOpenCodeConfig;
    builtinAgents: BuiltinAgentMap;
    sources: AgentSources;
    currentModel: string | undefined;
    useTaskSystem: boolean;
    disabledAgentNames: ReadonlySet<string>;
};
type AssemblyResult = {
    configuredDefaultAgent: string | undefined;
};
export declare function getConfiguredDefaultAgent(config: Record<string, unknown>): string | undefined;
export declare function assembleAgentConfig(params: AssembleAgentConfigParams): Promise<AssemblyResult>;
export {};

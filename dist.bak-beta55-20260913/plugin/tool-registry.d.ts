import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { SkillContext } from "./skill-context";
import type { PluginContext, ToolsRecord } from "./types";
import type { ToolRegistryFactories } from "./tool-registry-factories";
export { trimToolsToCap } from "./tool-registry-trimming";
export type ToolRegistryResult = {
    filteredTools: ToolsRecord;
    taskSystemEnabled: boolean;
};
export declare function createToolRegistry(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor" | "monitorManager">;
    skillContext: SkillContext;
    availableCategories: AvailableCategory[];
    interactiveBashEnabled?: boolean;
    toolFactories?: Partial<ToolRegistryFactories>;
}): ToolRegistryResult;

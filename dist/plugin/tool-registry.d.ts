import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { PluginContext, ToolsRecord } from "./types";
import type { Managers } from "../create-managers";
import type { SkillContext } from "./skill-context";
export type ToolRegistryResult = {
    filteredTools: ToolsRecord;
    taskSystemEnabled: boolean;
};
export declare function createToolRegistry(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager">;
    skillContext: SkillContext;
    availableCategories: AvailableCategory[];
}): ToolRegistryResult;

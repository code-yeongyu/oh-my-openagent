import type { ToolDefinition } from "@opencode-ai/plugin";
import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { SkillContext } from "./skill-context";
import type { PluginContext } from "./types";
import type { ToolRegistryFactories } from "./tool-registry-factories";
export declare function createCoreTools(args: {
    readonly ctx: PluginContext;
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor">;
    readonly skillContext: SkillContext;
    readonly availableCategories: AvailableCategory[];
    readonly factories: ToolRegistryFactories;
}): Record<string, ToolDefinition>;

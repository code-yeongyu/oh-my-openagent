import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { PluginContext } from "./types";
import type { ToolRegistryFactories } from "./tool-registry-factories";
export declare function getSisyphusJuniorModelOverride(agentOverride?: {
    model?: string;
}): string | undefined;
export declare function createTeamModeToolsRecord(args: {
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly ctx: PluginContext;
    readonly managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager">;
    readonly factories: ToolRegistryFactories;
}): Record<string, ToolDefinition>;

import type { OhMyOpenCodeConfig } from "./config";
import type { ModelCacheState } from "./plugin-state";
import type { PluginContext, TmuxConfig } from "./plugin/types";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { TmuxSessionManager } from "./features/tmux-subagent";
import { createConfigHandler } from "./plugin-handlers";
export type Managers = {
    tmuxSessionManager: TmuxSessionManager;
    backgroundManager: BackgroundManager;
    skillMcpManager: SkillMcpManager;
    configHandler: ReturnType<typeof createConfigHandler>;
};
export declare function createManagers(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    tmuxConfig: TmuxConfig;
    modelCacheState: ModelCacheState;
    backgroundNotificationHookEnabled: boolean;
}): Managers;

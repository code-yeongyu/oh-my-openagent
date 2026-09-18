import type { TeamModeConfig } from "../../config/schema/team-mode";
import type { BackgroundManager } from "../../features/background-agent/manager";
import type { TmuxSessionManager } from "../../features/tmux-subagent/manager";
type HookInput = {
    event: {
        type: string;
        properties?: unknown;
    };
};
export type HookImpl = (input: HookInput) => Promise<void>;
export declare function createTeamLeadOrphanHandler(config: TeamModeConfig, tmuxMgr?: TmuxSessionManager, bgMgr?: BackgroundManager): HookImpl;
export {};

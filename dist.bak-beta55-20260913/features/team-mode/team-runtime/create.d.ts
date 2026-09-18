import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { BackgroundManager } from "../../background-agent/manager";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import type { RuntimeState, TeamSpec } from "../types";
type CreateTeamRunOptions = {
    callerAgentTypeId?: string;
    parentMessageID?: string;
};
export declare class TeamRunCreateError extends Error {
    readonly cleanupReport: {
        cancelledTaskIds: string[];
        removedLayout: boolean;
        removedWorktrees: string[];
        errors: string[];
    };
    constructor(message: string, cleanupReport: {
        cancelledTaskIds: string[];
        removedLayout: boolean;
        removedWorktrees: string[];
        errors: string[];
    }, cause: Error);
}
export declare function createTeamRun(spec: TeamSpec, leadSessionId: string, ctx: ExecutorContext, config: TeamModeConfig, bgMgr: BackgroundManager, tmuxMgr?: TmuxSessionManager, options?: CreateTeamRunOptions): Promise<RuntimeState>;
export {};

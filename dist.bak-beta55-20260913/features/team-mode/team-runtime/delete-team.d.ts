import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { log } from "../../../shared/logger";
import type { BackgroundManager } from "../../background-agent/manager";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import { canVisualize, removeTeamLayout } from "../team-layout-tmux/layout";
export type DeleteTeamDeps = {
    canVisualize: typeof canVisualize;
    removeTeamLayout: typeof removeTeamLayout;
    log: typeof log;
};
export type DeleteTeamBackgroundManager = Pick<BackgroundManager, "getTasksByParentSession" | "cancelTask">;
export declare function deleteTeam(teamRunId: string, config: TeamModeConfig, tmuxMgr?: TmuxSessionManager, bgMgr?: DeleteTeamBackgroundManager, options?: {
    force?: boolean;
}, deps?: DeleteTeamDeps): Promise<{
    removedWorktrees: string[];
    removedLayout: boolean;
}>;

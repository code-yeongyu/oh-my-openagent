import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { BackgroundManager } from "../../background-agent/manager";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import type { TeamRunCreateError } from "./create";
type SpawnedMemberResource = {
    taskId?: string;
    worktreePath?: string;
};
export declare function cleanupTeamRunResources(args: {
    teamRunId: string;
    config: TeamModeConfig;
    resources: SpawnedMemberResource[];
    bgMgr: BackgroundManager;
    tmuxMgr?: TmuxSessionManager;
    createdLayout: boolean;
}): Promise<TeamRunCreateError["cleanupReport"]>;
export {};

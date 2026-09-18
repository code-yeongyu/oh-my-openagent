import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { log } from "../../../shared/logger";
import type { BackgroundManager } from "../../background-agent/manager";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import { deleteTeam } from "./delete-team";
export { clearSessionTeamRunCleanupRegistry, getSessionCreatedTeamRunIds, registerTeamRunForSessionCleanup, unregisterTeamRunForSessionCleanup, } from "./session-team-run-registry";
export type SessionTeamCleanupReport = {
    cleanedTeamRunIds: string[];
    removedLayoutTeamRunIds: string[];
    errors: string[];
};
export type SessionTeamCleanupDeps = {
    deleteTeam: typeof deleteTeam;
    log: typeof log;
};
export declare function cleanupSessionTeamRuns(args: {
    config: TeamModeConfig;
    tmuxMgr?: TmuxSessionManager;
    bgMgr?: BackgroundManager;
    deps?: SessionTeamCleanupDeps;
}): Promise<SessionTeamCleanupReport>;

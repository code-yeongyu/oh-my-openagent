import type { BackgroundManager } from "../../background-agent/manager";
import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { RuntimeState } from "../types";
export interface TeamStatus {
    teamName: string;
    teamRunId: string;
    status: RuntimeState["status"];
    leadSessionId?: string;
    createdAt: number;
    members: Array<{
        name: string;
        sessionId?: string;
        status: RuntimeState["members"][number]["status"];
        color?: string;
        worktreePath?: string;
        unreadMessages: number;
        paneId?: string;
    }>;
    tasks: {
        pending: number;
        claimed: number;
        in_progress: number;
        completed: number;
        deleted: number;
        total: number;
    };
    shutdownRequests: RuntimeState["shutdownRequests"];
    concurrency: {
        runningOnSameModel: number;
        queuedOnSameModel: number;
        teamRunIdSpecific?: number;
    };
    bounds: RuntimeState["bounds"];
    staleLocks: string[];
}
export declare function aggregateStatus(teamRunId: string, config: TeamModeConfig, bgMgr?: BackgroundManager): Promise<TeamStatus>;

import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { OpencodeClient } from "../../../tools/delegate-task/types";
import type { BackgroundManager } from "../../background-agent/manager";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import { approveShutdown, deleteTeam, rejectShutdown, requestShutdownOfMember } from "../team-runtime/shutdown";
import { type TeamRuntimeStoreDeps } from "./lifecycle-participant";
type TeamShutdownToolDeps = TeamRuntimeStoreDeps & {
    deleteTeam: typeof deleteTeam;
    requestShutdownOfMember: typeof requestShutdownOfMember;
    approveShutdown: typeof approveShutdown;
    rejectShutdown: typeof rejectShutdown;
};
export declare function createTeamDeleteTool(config: TeamModeConfig, client: OpencodeClient, backgroundManager: BackgroundManager, tmuxMgr?: TmuxSessionManager, deps?: TeamShutdownToolDeps): ToolDefinition;
export declare function createTeamShutdownRequestTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamShutdownToolDeps): ToolDefinition;
export declare function createTeamApproveShutdownTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamShutdownToolDeps): ToolDefinition;
export declare function createTeamRejectShutdownTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamShutdownToolDeps): ToolDefinition;
export {};

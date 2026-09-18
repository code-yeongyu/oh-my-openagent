import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { OpencodeClient } from "../../../tools/delegate-task/types";
import type { BackgroundManager } from "../../background-agent/manager";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import { loadTeamSpec } from "@oh-my-opencode/team-core/team-registry/loader";
import { createTeamRun } from "../team-runtime/create";
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store";
import { type TeamCreateExecutorConfig } from "./lifecycle-inline-spec";
type TeamCreateToolDeps = {
    createTeamRun: typeof createTeamRun;
    loadTeamSpec: typeof loadTeamSpec;
    listActiveTeams: typeof listActiveTeams;
    loadRuntimeState: typeof loadRuntimeState;
};
export declare function createTeamCreateTool(config: TeamModeConfig, client: OpencodeClient, bgMgr: BackgroundManager, tmuxMgr?: TmuxSessionManager, executorConfig?: TeamCreateExecutorConfig, deps?: TeamCreateToolDeps): ToolDefinition;
export {};

import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { OpencodeClient } from "../../../tools/delegate-task/types";
import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store";
import { createTask, getTask, listTasks, updateTaskStatus, claimTask } from "@oh-my-opencode/team-core/team-tasklist";
type TeamTaskToolDeps = {
    loadRuntimeState: typeof loadRuntimeState;
    createTask: typeof createTask;
    listTasks: typeof listTasks;
    claimTask: typeof claimTask;
    updateTaskStatus: typeof updateTaskStatus;
    getTask: typeof getTask;
};
export declare function createTeamTaskCreateTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamTaskToolDeps): ToolDefinition;
export declare function createTeamTaskListTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamTaskToolDeps): ToolDefinition;
export declare function createTeamTaskUpdateTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamTaskToolDeps): ToolDefinition;
export declare function createTeamTaskGetTool(config: TeamModeConfig, client: OpencodeClient, deps?: TeamTaskToolDeps): ToolDefinition;
export {};

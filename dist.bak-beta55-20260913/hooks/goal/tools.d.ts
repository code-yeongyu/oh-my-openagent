import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { GoalController } from "./controller";
export type GoalToolsDeps = {
    readonly controller: GoalController;
    readonly getSessionID: () => string | undefined;
};
export declare function createGoalTool(deps: GoalToolsDeps): ToolDefinition;
export declare function updateGoalTool(deps: GoalToolsDeps): ToolDefinition;
export declare function getGoalTool(deps: GoalToolsDeps): ToolDefinition;
export declare function createGoalTools(deps: GoalToolsDeps): Record<string, ToolDefinition>;

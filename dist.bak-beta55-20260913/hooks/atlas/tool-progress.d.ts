import type { SessionState } from "./types";
export declare const MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS = 3;
export type ToolProgressOutput = {
    title?: string;
    output?: string;
};
export declare function isTangibleProgressTool(toolName: string): boolean;
export declare function didToolMakeProgress(output: ToolProgressOutput): boolean;
export declare function recordToolProgress(state: SessionState, now?: number): void;
export declare function resetStallStateForPlanChange(state: SessionState, planPath: string): void;
export declare function markContinuationInjectedAwaitingToolProgress(state: SessionState): void;
export declare function updateNoToolProgressIterations(state: SessionState): number;
export declare function shouldAbortForNoToolProgress(state: SessionState): boolean;
export declare function markContinuationStalled(state: SessionState, planName: string, planPath: string): void;

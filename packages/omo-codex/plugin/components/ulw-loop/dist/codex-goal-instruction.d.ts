import { type UlwLoopToolkitSurface } from "./surface.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
export interface CodexCreateGoalPayload {
    readonly objective: string;
}
export interface UlwLoopGoalInstruction {
    readonly text: string;
    readonly json: CodexCreateGoalPayload;
}
export declare function buildCodexGoalInstruction(args: {
    readonly plan: UlwLoopPlan;
    readonly goal: UlwLoopItem;
    readonly isFinal?: boolean;
    readonly surface?: UlwLoopToolkitSurface;
}): UlwLoopGoalInstruction;

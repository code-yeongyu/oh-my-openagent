import { type CheckpointUlwLoopArgs, type CheckpointUlwLoopResult } from "./checkpoint.js";
import { type UlwLoopGoalInstruction } from "./codex-goal-instruction.js";
import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopItem } from "./types.js";
type ContinuationNext = {
    readonly resumed: boolean;
    readonly goal: UlwLoopItem;
    readonly instruction: UlwLoopGoalInstruction;
} | {
    readonly done: true;
    readonly blocked: boolean;
    readonly handoff: string;
};
export type CheckpointAndContinueResult = CheckpointUlwLoopResult & {
    readonly next?: ContinuationNext;
};
export declare function checkpointAndContinue(repoRoot: string, args: CheckpointUlwLoopArgs & {
    readonly advance: boolean;
}, scope?: UlwLoopScope): Promise<CheckpointAndContinueResult>;
export declare function checkpoint(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export {};

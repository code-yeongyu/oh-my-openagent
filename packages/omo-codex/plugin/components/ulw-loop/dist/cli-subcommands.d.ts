import { type UlwLoopScope } from "./paths.js";
export declare function createGoals(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function status(repoRoot: string, json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function completeGoals(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function steer(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function addGoal(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function criteria(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function captureEvidence(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;
export declare function reviewBlockers(repoRoot: string, argv: readonly string[], json: boolean, scope?: UlwLoopScope): Promise<number>;

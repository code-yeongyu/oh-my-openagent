import type { SteerUlwLoopBatchResult } from "./steering-batch.js";
import type { SteerUlwLoopResult, UlwLoopSteeringMutationKind, UlwLoopSteeringProposal, UlwLoopSteeringSource, UlwLoopSuccessCriterionUserModel } from "./types.js";
export type CliSteeringProposal = UlwLoopSteeringProposal & {
    readonly goalId?: string;
    readonly scenario?: string;
    readonly expectedEvidence?: string;
    readonly userModel?: UlwLoopSuccessCriterionUserModel;
};
export declare function parseSteeringKind(argv: readonly string[]): UlwLoopSteeringMutationKind;
export declare function parseSteeringSource(argv: readonly string[]): UlwLoopSteeringSource;
export declare function parseSteeringProposal(argv: readonly string[]): Promise<CliSteeringProposal>;
export declare function normalizeSteeringProposal(proposal: CliSteeringProposal): CliSteeringProposal;
export declare function parseSteeringProposals(argv: readonly string[]): Promise<readonly CliSteeringProposal[]>;
export declare function printSteerResult(result: SteerUlwLoopResult, json: boolean): void;
export declare function printSteerBatchResult(result: SteerUlwLoopBatchResult, json: boolean): void;

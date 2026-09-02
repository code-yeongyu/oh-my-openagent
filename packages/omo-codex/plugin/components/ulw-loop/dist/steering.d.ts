import type { UlwLoopScope } from "./paths.js";
import type { SteerUlwLoopResult, UlwLoopPlan, UlwLoopSteeringAudit, UlwLoopSteeringProposal } from "./types.js";
export declare function validateUlwLoopSteeringProposal(plan: UlwLoopPlan, proposal: unknown): UlwLoopSteeringAudit;
export declare function applySteeringMutation(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, audit: UlwLoopSteeringAudit): UlwLoopPlan;
export declare function parseUlwLoopSteeringDirective(text: string): UlwLoopSteeringProposal | null;
export declare function steerUlwLoop(repoRoot: string, proposal: UlwLoopSteeringProposal, scope?: UlwLoopScope): Promise<SteerUlwLoopResult>;

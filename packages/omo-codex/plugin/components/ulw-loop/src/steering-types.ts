import type { UlwLoopSteeringMutationKind, UlwLoopSteeringSource } from "./constants.js";
import type { UlwLoopPlan } from "./domain-types.js";

export interface UlwLoopSteeringInvariantResult {
	accepted: boolean;
	structuralInvariantAccepted: boolean;
	evidenceBackedNecessity: boolean;
	noEasierCompletion: boolean;
	rejectedReasons: string[];
	reasons?: string[];
}

export interface UlwLoopSteeringChildGoal {
	title: string;
	objective: string;
}

export interface UlwLoopSteeringAfterPayload {
	title?: string;
	objective?: string;
	pendingGoalIds?: string[];
	children?: UlwLoopSteeringChildGoal[];
}

export interface UlwLoopSteeringProposal {
	kind: UlwLoopSteeringMutationKind;
	source: UlwLoopSteeringSource;
	targetGoalId?: string;
	targetGoalIds?: string[];
	criterionId?: string;
	evidence: string;
	rationale: string;
	title?: string;
	objective?: string;
	childGoals?: UlwLoopSteeringChildGoal[];
	revisedTitle?: string;
	revisedObjective?: string;
	pendingOrder?: string[];
	blockedReason?: string;
	after?: UlwLoopSteeringAfterPayload;
	directiveText?: string;
	promptSignature?: string;
	idempotencyKey?: string;
	now?: Date;
}

export interface UlwLoopSteeringAudit {
	kind: UlwLoopSteeringMutationKind;
	source: UlwLoopSteeringSource;
	targetGoalIds: string[];
	criterionId?: string;
	before?: unknown;
	after?: unknown;
	evidence: string;
	rationale: string;
	invariant: UlwLoopSteeringInvariantResult;
	directiveText?: string;
	promptSignature?: string;
	idempotencyKey?: string;
	deduped?: boolean;
}

export interface SteerUlwLoopResult {
	plan: UlwLoopPlan;
	accepted: boolean;
	audit: UlwLoopSteeringAudit;
	rejectedReasons: string[];
	deduped: boolean;
}

import type {
	UlwLoopCodexGoalMode,
	UlwLoopCriterionStatus,
	UlwLoopLedgerEventKind,
	UlwLoopStatus,
	UlwLoopSteeringMutationKind,
	UlwLoopSteeringStatus,
	UlwLoopSuccessCriterionUserModel,
} from "./constants.js";
import type { UlwLoopSteeringAudit } from "./steering-types.js";

export interface UlwLoopSuccessCriterion {
	readonly id: string;
	readonly scenario: string;
	readonly userModel: UlwLoopSuccessCriterionUserModel;
	readonly expectedEvidence: string;
	capturedEvidence: string | null;
	status: UlwLoopCriterionStatus;
	capturedAt?: string;
	notes?: string;
}

export interface UlwLoopItem {
	id: string;
	title: string;
	objective: string;
	status: UlwLoopStatus;
	successCriteria: UlwLoopSuccessCriterion[];
	attempt: number;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	completedAt?: string;
	failedAt?: string;
	reviewBlockedAt?: string;
	evidence?: string;
	failureReason?: string;
	steeringStatus?: UlwLoopSteeringStatus;
	supersededBy?: string[];
	supersedes?: string[];
	blockedReason?: string;
	blockerSignature?: string;
	blockerOccurrenceCount?: number;
	requiredExternalDecision?: string;
	nonRetriable?: boolean;
	steeringEvidence?: string;
	steeringRationale?: string;
}

export interface UlwLoopAggregateCompletion {
	status: "complete";
	completedAt: string;
	evidence: string;
	codexGoal?: unknown;
}

export interface UlwLoopPlan {
	version: 1;
	createdAt: string;
	updatedAt: string;
	briefPath: string;
	goalsPath: string;
	ledgerPath: string;
	codexGoalMode?: UlwLoopCodexGoalMode;
	codexObjective?: string;
	codexObjectiveAliases?: string[];
	aggregateCompletion?: UlwLoopAggregateCompletion;
	activeGoalId?: string;
	goals: UlwLoopItem[];
}

export interface UlwLoopQualityGate {
	aiSlopCleaner: { status: "passed"; evidence: string };
	verification: { status: "passed"; commands: string[]; evidence: string };
	codeReview: { recommendation: "APPROVE"; architectStatus: "CLEAR"; evidence: string };
}

export interface UlwLoopLedgerEntry {
	at: string;
	kind: UlwLoopLedgerEventKind;
	goalId?: string;
	criterionId?: string;
	status?: UlwLoopStatus;
	criterionStatus?: UlwLoopCriterionStatus;
	message?: string;
	codexGoal?: unknown;
	evidence?: string;
	capturedEvidence?: string;
	qualityGate?: UlwLoopQualityGate;
	steering?: UlwLoopSteeringAudit;
	before?: unknown;
	after?: unknown;
	mutationKind?: UlwLoopSteeringMutationKind;
	idempotencyKey?: string;
	blockerSignature?: string;
	blockerOccurrenceCount?: number;
	requiredExternalDecision?: string;
}

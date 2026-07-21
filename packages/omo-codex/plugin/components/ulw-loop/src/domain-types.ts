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
	readonly essential?: boolean;
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

export interface UlwLoopValidationBatch {
	readonly batchId: string;
	readonly memberIds: readonly string[];
	readonly finalGoalId: string;
}

export interface UlwLoopPlan {
	version: 1;
	evidenceLayoutVersion?: 2;
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
	validationBatches?: readonly UlwLoopValidationBatch[];
	goals: UlwLoopItem[];
}

export type UlwLoopManualQaSurface = "cli" | "http" | "tmux" | "browser" | "gui" | "data";
export type UlwLoopManualQaArtifactKind = "cli-transcript" | "log" | "screenshot" | "image" | "http-dump" | "data-diff";

export interface UlwLoopManualQaArtifactRef {
	readonly id: string;
	readonly kind: UlwLoopManualQaArtifactKind;
	readonly description: string;
	readonly path: string;
}

export interface UlwLoopManualQaSurfaceEvidence {
	readonly id: string;
	readonly criterionRef: string;
	readonly surface: UlwLoopManualQaSurface;
	readonly invocation: string;
	readonly verdict: "passed";
	readonly artifactRefs: readonly string[];
}

export interface UlwLoopManualQaAdversarialCase {
	readonly id: string;
	readonly criterionRef: string;
	readonly scenario: string;
	readonly expectedBehavior: string;
	readonly verdict: "passed" | "not_applicable";
	readonly reason?: string;
	readonly artifactRefs: readonly string[];
}

export interface UlwLoopQualityGate {
	readonly codeReview: {
		readonly by: string;
		readonly recommendation: "APPROVE";
		readonly codeQualityStatus: "CLEAR" | "WATCH";
		readonly reportPath: string;
		readonly evidence: string;
		readonly blockers: readonly [];
	};
	readonly manualQa: {
		readonly by: string;
		readonly status: "passed";
		readonly evidence: string;
		readonly surfaceEvidence: readonly UlwLoopManualQaSurfaceEvidence[];
		readonly adversarialCases: readonly UlwLoopManualQaAdversarialCase[];
		readonly artifactRefs: readonly UlwLoopManualQaArtifactRef[];
	};
	readonly gateReview: {
		readonly by: string;
		readonly recommendation: "APPROVE";
		readonly reportPath: string;
		readonly evidence: string;
		readonly blockers: readonly [];
	};
	readonly iteration: {
		readonly fullRerun: true;
		readonly status: "passed";
		readonly rerunCommands: readonly string[];
		readonly evidence: string;
	};
	readonly criteriaCoverage: {
		readonly totalCriteria: number;
		readonly passCount: number;
		readonly originalIntent: string;
		readonly desiredOutcome: string;
		readonly userOutcomeReview: string;
		readonly adversarialClassesCovered: readonly string[];
	};
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
	qualityGate?: unknown;
	steering?: UlwLoopSteeringAudit;
	before?: unknown;
	after?: unknown;
	mutationKind?: UlwLoopSteeringMutationKind;
	idempotencyKey?: string;
	blockerSignature?: string;
	blockerOccurrenceCount?: number;
	requiredExternalDecision?: string;
}

export const ULW_LOOP_DIR = ".omo/ulw-loop";
export const ULW_LOOP_BRIEF = "brief.md";
export const ULW_LOOP_GOALS = "goals.json";
export const ULW_LOOP_LEDGER = "ledger.jsonl";

export type UlwLoopStatus =
	| "pending"
	| "in_progress"
	| "complete"
	| "failed"
	| "blocked"
	| "review_blocked"
	| "needs_user_decision";

export type UlwLoopCodexGoalMode = "aggregate" | "per_story";

export type UlwLoopSteeringStatus = "superseded" | "blocked";

export const ULW_LOOP_STEERING_MUTATION_KINDS = [
	"add_subgoal",
	"split_subgoal",
	"reorder_pending",
	"revise_pending_wording",
	"revise_criterion",
	"annotate_ledger",
	"mark_blocked_superseded",
] as const satisfies readonly string[];
export type UlwLoopSteeringMutationKind = (typeof ULW_LOOP_STEERING_MUTATION_KINDS)[number];

export type UlwLoopSteeringSource = "user_prompt_submit" | "finding" | "cli";

export const ULW_LOOP_SUCCESS_CRITERION_USER_MODELS = [
	"happy",
	"edge",
	"regression",
	"adversarial",
] as const satisfies readonly string[];
export type UlwLoopSuccessCriterionUserModel = (typeof ULW_LOOP_SUCCESS_CRITERION_USER_MODELS)[number];

export const ULW_LOOP_CRITERION_STATUSES = ["pending", "pass", "fail", "blocked"] as const satisfies readonly string[];
export type UlwLoopCriterionStatus = (typeof ULW_LOOP_CRITERION_STATUSES)[number];

export const ULW_LOOP_LEDGER_EVENT_KINDS = [
	"plan_created",
	"goal_started",
	"goal_resumed",
	"goal_completed",
	"goal_blocked",
	"goal_failed",
	"goal_needs_user_decision",
	"goal_retried",
	"aggregate_completed",
	"aggregate_objective_migrated",
	"goal_added",
	"steering_accepted",
	"steering_rejected",
	"final_review_failed",
	"goal_review_blocked",
	"evidence_captured",
	"criterion_failed",
	"criterion_blocked",
	"criteria_revised",
] as const satisfies readonly string[];
export type UlwLoopLedgerEventKind = (typeof ULW_LOOP_LEDGER_EVENT_KINDS)[number];

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

export interface CreateUlwLoopOptions {
	brief: string;
	goals?: Array<{ title?: string; objective: string }>;
	codexGoalMode?: UlwLoopCodexGoalMode;
	now?: Date;
	force?: boolean;
}

export interface StartNextOptions {
	now?: Date;
	retryFailed?: boolean;
}

export interface CheckpointOptions {
	goalId: string;
	status: Extract<UlwLoopStatus, "complete" | "failed"> | "blocked";
	evidence?: string;
	codexGoal?: unknown;
	qualityGate?: unknown;
	allowActiveFinalCodexGoal?: boolean;
	now?: Date;
}

export interface AddUlwLoopGoalOptions {
	title: string;
	objective: string;
	evidence?: string;
	now?: Date;
}

export interface RecordFinalReviewBlockersOptions extends AddUlwLoopGoalOptions {
	goalId: string;
	codexGoal?: unknown;
}

export interface UlwLoopQualityGate {
	aiSlopCleaner: { status: "passed"; evidence: string };
	verification: { status: "passed"; commands: string[]; evidence: string };
	codeReview: { recommendation: "APPROVE"; architectStatus: "CLEAR"; evidence: string };
}

export interface UlwLoopErrorOptions {
	readonly cause?: unknown;
	readonly details?: Record<string, unknown>;
}

export class UlwLoopError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(message: string, code: string, opts?: UlwLoopErrorOptions) {
		super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
		this.name = "UlwLoopError";
		this.code = code;
		if (opts?.details !== undefined) {
			this.details = opts.details;
		}
	}
}

export function iso(): string {
	return new Date().toISOString();
}

export const ULTRAGOAL_DIR = ".omo/ultragoal";
export const ULTRAGOAL_BRIEF = "brief.md";
export const ULTRAGOAL_GOALS = "goals.json";
export const ULTRAGOAL_LEDGER = "ledger.jsonl";

export type UltragoalStatus =
	| "pending"
	| "in_progress"
	| "complete"
	| "failed"
	| "blocked"
	| "review_blocked"
	| "needs_user_decision";

export type UltragoalCodexGoalMode = "aggregate" | "per_story";

export type UltragoalSteeringStatus = "superseded" | "blocked";

export const ULTRAGOAL_STEERING_MUTATION_KINDS = [
	"add_subgoal",
	"split_subgoal",
	"reorder_pending",
	"revise_pending_wording",
	"revise_criterion",
	"annotate_ledger",
	"mark_blocked_superseded",
] as const satisfies readonly string[];
export type UltragoalSteeringMutationKind = (typeof ULTRAGOAL_STEERING_MUTATION_KINDS)[number];

export type UltragoalSteeringSource = "user_prompt_submit" | "finding" | "cli";

export const ULTRAGOAL_SUCCESS_CRITERION_USER_MODELS = [
	"happy",
	"edge",
	"regression",
	"adversarial",
] as const satisfies readonly string[];
export type UltragoalSuccessCriterionUserModel = (typeof ULTRAGOAL_SUCCESS_CRITERION_USER_MODELS)[number];

export const ULTRAGOAL_CRITERION_STATUSES = ["pending", "pass", "fail", "blocked"] as const satisfies readonly string[];
export type UltragoalCriterionStatus = (typeof ULTRAGOAL_CRITERION_STATUSES)[number];

export const ULTRAGOAL_LEDGER_EVENT_KINDS = [
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
export type UltragoalLedgerEventKind = (typeof ULTRAGOAL_LEDGER_EVENT_KINDS)[number];

export interface UltragoalSuccessCriterion {
	readonly id: string;
	readonly scenario: string;
	readonly userModel: UltragoalSuccessCriterionUserModel;
	readonly expectedEvidence: string;
	capturedEvidence: string | null;
	status: UltragoalCriterionStatus;
	capturedAt?: string;
	notes?: string;
}

export interface UltragoalSteeringInvariantResult {
	accepted: boolean;
	structuralInvariantAccepted: boolean;
	evidenceBackedNecessity: boolean;
	noEasierCompletion: boolean;
	rejectedReasons: string[];
	reasons?: string[];
}

export interface UltragoalSteeringChildGoal {
	title: string;
	objective: string;
}

export interface UltragoalSteeringAfterPayload {
	title?: string;
	objective?: string;
	pendingGoalIds?: string[];
	children?: UltragoalSteeringChildGoal[];
}

export interface UltragoalSteeringProposal {
	kind: UltragoalSteeringMutationKind;
	source: UltragoalSteeringSource;
	targetGoalId?: string;
	targetGoalIds?: string[];
	criterionId?: string;
	evidence: string;
	rationale: string;
	title?: string;
	objective?: string;
	childGoals?: UltragoalSteeringChildGoal[];
	revisedTitle?: string;
	revisedObjective?: string;
	pendingOrder?: string[];
	blockedReason?: string;
	after?: UltragoalSteeringAfterPayload;
	directiveText?: string;
	promptSignature?: string;
	idempotencyKey?: string;
	now?: Date;
}

export interface UltragoalSteeringAudit {
	kind: UltragoalSteeringMutationKind;
	source: UltragoalSteeringSource;
	targetGoalIds: string[];
	criterionId?: string;
	before?: unknown;
	after?: unknown;
	evidence: string;
	rationale: string;
	invariant: UltragoalSteeringInvariantResult;
	directiveText?: string;
	promptSignature?: string;
	idempotencyKey?: string;
	deduped?: boolean;
}

export interface SteerUltragoalResult {
	plan: UltragoalPlan;
	accepted: boolean;
	audit: UltragoalSteeringAudit;
	rejectedReasons: string[];
	deduped: boolean;
}

export interface UltragoalItem {
	id: string;
	title: string;
	objective: string;
	status: UltragoalStatus;
	successCriteria: UltragoalSuccessCriterion[];
	attempt: number;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	completedAt?: string;
	failedAt?: string;
	reviewBlockedAt?: string;
	evidence?: string;
	failureReason?: string;
	steeringStatus?: UltragoalSteeringStatus;
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

export interface UltragoalAggregateCompletion {
	status: "complete";
	completedAt: string;
	evidence: string;
	codexGoal?: unknown;
}

export interface UltragoalPlan {
	version: 1;
	createdAt: string;
	updatedAt: string;
	briefPath: string;
	goalsPath: string;
	ledgerPath: string;
	codexGoalMode?: UltragoalCodexGoalMode;
	codexObjective?: string;
	codexObjectiveAliases?: string[];
	aggregateCompletion?: UltragoalAggregateCompletion;
	activeGoalId?: string;
	goals: UltragoalItem[];
}

export interface UltragoalLedgerEntry {
	at: string;
	kind: UltragoalLedgerEventKind;
	goalId?: string;
	criterionId?: string;
	status?: UltragoalStatus;
	criterionStatus?: UltragoalCriterionStatus;
	message?: string;
	codexGoal?: unknown;
	evidence?: string;
	capturedEvidence?: string;
	qualityGate?: UltragoalQualityGate;
	steering?: UltragoalSteeringAudit;
	before?: unknown;
	after?: unknown;
	mutationKind?: UltragoalSteeringMutationKind;
	idempotencyKey?: string;
	blockerSignature?: string;
	blockerOccurrenceCount?: number;
	requiredExternalDecision?: string;
}

export interface CreateUltragoalOptions {
	brief: string;
	goals?: Array<{ title?: string; objective: string }>;
	codexGoalMode?: UltragoalCodexGoalMode;
	now?: Date;
	force?: boolean;
}

export interface StartNextOptions {
	now?: Date;
	retryFailed?: boolean;
}

export interface CheckpointOptions {
	goalId: string;
	status: Extract<UltragoalStatus, "complete" | "failed"> | "blocked";
	evidence?: string;
	codexGoal?: unknown;
	qualityGate?: unknown;
	allowActiveFinalCodexGoal?: boolean;
	now?: Date;
}

export interface AddUltragoalGoalOptions {
	title: string;
	objective: string;
	evidence?: string;
	now?: Date;
}

export interface RecordFinalReviewBlockersOptions extends AddUltragoalGoalOptions {
	goalId: string;
	codexGoal?: unknown;
}

export interface UltragoalQualityGate {
	aiSlopCleaner: { status: "passed"; evidence: string };
	verification: { status: "passed"; commands: string[]; evidence: string };
	codeReview: { recommendation: "APPROVE"; architectStatus: "CLEAR"; evidence: string };
}

export interface UltragoalErrorOptions {
	readonly cause?: unknown;
	readonly details?: Record<string, unknown>;
}

export class UltragoalError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(message: string, code: string, opts?: UltragoalErrorOptions) {
		super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
		this.name = "UltragoalError";
		this.code = code;
		if (opts?.details !== undefined) {
			this.details = opts.details;
		}
	}
}

export function iso(): string {
	return new Date().toISOString();
}

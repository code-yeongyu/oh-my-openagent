export const ULW_LOOP_OPERATIONS = [
	"help",
	"create-goals",
	"status",
	"complete-goals",
	"checkpoint",
	"steer",
	"add-goal",
	"criteria",
	"record-evidence",
	"record-review-blockers",
] as const;

export type UlwLoopOperation = (typeof ULW_LOOP_OPERATIONS)[number];

export interface ToolkitOperationManifest {
	readonly name: UlwLoopOperation;
	/** The camelCase method that runs this operation on every SDK surface. */
	readonly method: string;
	readonly mutating: boolean;
	readonly description: string;
	/** Argument field -> type notation; a trailing `?` marks an optional field. */
	readonly args: Readonly<Record<string, string>>;
}

export interface ToolkitManifest {
	readonly version: 1;
	readonly name: "ulw-loop";
	readonly operations: readonly ToolkitOperationManifest[];
}

const CRITERION_INPUT =
	'{ scenario: string, expectedEvidence: string, userModel?: "happy" | "edge" | "regression" | "adversarial", essential?: boolean }';
const STEER_KINDS =
	'"add_subgoal" | "split_subgoal" | "reorder_pending" | "revise_pending_wording" | "revise_criterion" | "annotate_ledger" | "mark_blocked_superseded"';

export const ULW_LOOP_MANIFEST = {
	version: 1,
	name: "ulw-loop",
	operations: [
		{
			name: "help",
			method: "help",
			mutating: false,
			description: "Return this manifest: every operation with its method name, argument fields, and what it does.",
			args: {},
		},
		{
			name: "create-goals",
			method: "createGoals",
			mutating: true,
			description:
				"Create the session plan from a brief; one goal per bullet, each seeded with placeholder criteria until revised.",
			args: {
				brief: "string",
				codexGoalMode: '"aggregate" | "per_story"?',
				force: "boolean?",
				validationBatchesJson: "string?",
			},
		},
		{
			name: "status",
			method: "status",
			mutating: false,
			description:
				"Read the plan, its summary, structured nextActions, the stable evidenceRoot, and the active goal's currentAttemptDir.",
			args: {},
		},
		{
			name: "complete-goals",
			method: "completeGoals",
			mutating: true,
			description:
				"Acquire the next eligible goal or resume the in-progress one; returns { done: true } once the aggregate is complete.",
			args: { retryFailed: "boolean?" },
		},
		{
			name: "checkpoint",
			method: "checkpoint",
			mutating: true,
			description:
				"Close the goal as complete, failed, or blocked with evidence; the final goal also needs the quality gate. printTemplate returns that gate's template instead.",
			args: {
				goalId: "string",
				status: '"complete" | "failed" | "blocked"',
				evidence: "string",
				codexGoalJson: "string?",
				qualityGateJson: "string?",
				printTemplate: "true? (with goalId? only)",
			},
		},
		{
			name: "steer",
			method: "steer",
			mutating: true,
			description:
				"Propose an evidence-backed plan mutation; revise_criterion replaces a criterion's scenario, expectedEvidence, or userModel.",
			args: {
				kind: STEER_KINDS,
				source: '"finding" | "user_prompt_submit" | "cli"',
				evidence: "string",
				rationale: "string",
				goalId: "string?",
				criterionId: "string? (revise_criterion)",
				scenario: "string? (revise_criterion)",
				expectedEvidence: "string? (revise_criterion)",
				userModel: '"happy" | "edge" | "regression" | "adversarial"? (revise_criterion)',
				title: "string? (add_subgoal)",
				objective: "string? (add_subgoal)",
				childGoals: "{ title: string, objective: string }[]? (split_subgoal)",
				revisedTitle: "string? (revise_pending_wording)",
				revisedObjective: "string? (revise_pending_wording)",
				pendingOrder: "string[]? (reorder_pending)",
				blockedReason: "string? (mark_blocked_superseded)",
				idempotencyKey: "string?",
			},
		},
		{
			name: "add-goal",
			method: "addGoal",
			mutating: true,
			description:
				"Append a goal; pass successCriteria to define its criteria in the same call, otherwise placeholders name the revise call.",
			args: { title: "string", objective: "string", successCriteria: `${CRITERION_INPUT}[]?` },
		},
		{
			name: "criteria",
			method: "criteria",
			mutating: false,
			description: "List one goal's success criteria with their status and captured evidence.",
			args: { goalId: "string" },
		},
		{
			name: "record-evidence",
			method: "recordEvidence",
			mutating: true,
			description:
				"Record a criterion's pass, fail, or blocked evidence; artifacts must exist (resolved against the session cwd) and are stored with the criterion and the ledger entry.",
			args: {
				goalId: "string",
				criterionId: "string",
				status: '"pass" | "fail" | "blocked"',
				evidence: "string",
				notes: "string?",
				artifacts: "string[]?",
			},
		},
		{
			name: "record-review-blockers",
			method: "recordReviewBlockers",
			mutating: true,
			description: "Mark the final goal review_blocked and append the blocker goal the reviewer verdict names.",
			args: { goalId: "string", title: "string", objective: "string", evidence: "string", codexGoalJson: "string?" },
		},
	] satisfies readonly ToolkitOperationManifest[],
} satisfies ToolkitManifest;

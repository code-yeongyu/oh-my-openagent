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
	readonly method: string;
	readonly mutating: boolean;
	readonly description: string;
	readonly args: Readonly<Record<string, string>>;
}

export interface ToolkitManifest {
	readonly version: 1;
	readonly name: "ulw-loop";
	readonly operations: readonly ToolkitOperationManifest[];
}

export const ULW_LOOP_MANIFEST = {
	version: 1,
	name: "ulw-loop",
	operations: [
		{
			name: "help",
			method: "help",
			mutating: false,
			description: "Returns this manifest with every operation, its method name, arguments, and description.",
			args: {},
		},
		{
			name: "create-goals",
			method: "createGoals",
			mutating: true,
			description: "Seeds the plan from a brief text. One line per goal.",
			args: { brief: "string — plan brief text, one line per goal" },
		},
		{
			name: "status",
			method: "status",
			mutating: false,
			description: "Reads the current plan, summary, nextActions, and currentAttemptDir.",
			args: {},
		},
		{
			name: "complete-goals",
			method: "completeGoals",
			mutating: true,
			description: "Acquires the next pending goal. A run finishes only when every goal is checkpointed complete.",
			args: { retryFailed: "boolean? — also re-acquire previously failed goals" },
		},
		{
			name: "checkpoint",
			method: "checkpoint",
			mutating: true,
			description: "Closes a goal (complete/failed/blocked) or returns its quality-gate template when printTemplate is true.",
			args: {
				goalId: "string",
				status: "'complete' | 'failed' | 'blocked'",
				evidence: "string — observable proof",
				printTemplate: "boolean? — return quality-gate template instead of closing",
				codexGoalJson: "string? — driver goal snapshot JSON",
				qualityGateJson: "string? — filled quality-gate JSON",
			},
		},
		{
			name: "steer",
			method: "steer",
			mutating: true,
			description: "Proposes a plan mutation (add_subgoal, split_subgoal, reorder_pending, revise_pending_wording, revise_criterion, annotate_ledger, mark_blocked_superseded).",
			args: {
				kind: "string — mutation kind",
				evidence: "string",
				rationale: "string",
				goalId: "string? — target goal",
				criterionId: "string? — for revise_criterion",
				scenario: "string? — for revise_criterion",
				expectedEvidence: "string? — for revise_criterion",
			},
		},
		{
			name: "add-goal",
			method: "addGoal",
			mutating: true,
			description: "Appends a new goal to the plan. Optionally accepts success criteria to avoid placeholders.",
			args: {
				title: "string",
				objective: "string",
				successCriteria: "Array<{ scenario, expectedEvidence, userModel?, essential? }>? — omit for defaults",
			},
		},
		{
			name: "criteria",
			method: "criteria",
			mutating: false,
			description: "Lists success criteria for a goal.",
			args: { goalId: "string" },
		},
		{
			name: "record-evidence",
			method: "recordEvidence",
			mutating: true,
			description: "Records evidence for a criterion. Optionally validates artifact paths.",
			args: {
				goalId: "string",
				criterionId: "string",
				status: "'pass' | 'fail' | 'blocked'",
				evidence: "string — observable proof",
				notes: "string?",
				artifacts: "string[]? — relative paths validated against session cwd",
			},
		},
		{
			name: "record-review-blockers",
			method: "recordReviewBlockers",
			mutating: true,
			description: "Records review blockers for a goal and appends a follow-up goal.",
			args: {
				goalId: "string",
				title: "string",
				objective: "string",
				evidence: "string",
				codexGoalJson: "string? — driver goal snapshot",
			},
		},
	] satisfies readonly ToolkitOperationManifest[],
} satisfies ToolkitManifest;

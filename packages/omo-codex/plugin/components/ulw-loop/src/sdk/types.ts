import type { CheckpointUlwLoopArgs, CheckpointUlwLoopResult } from "../checkpoint.js";
import type { CheckpointTemplate } from "../checkpoint-template.js";
import type { recordEvidence } from "../evidence.js";
import type { addUlwLoopGoal, createUlwLoopPlan, startNextUlwLoop, summarizeUlwLoopPlan } from "../plan-crud.js";
import type { recordFinalReviewBlockers } from "../review-blockers.js";
import type { steerUlwLoop } from "../steering.js";
import type { UlwLoopSteeringProposal } from "../steering-types.js";
import type { UlwLoopToolkitSurface } from "../surface.js";
import type { UlwLoopPlan } from "../types.js";
import type { ULW_LOOP_MANIFEST, UlwLoopOperation } from "./manifest.js";

export type ToolkitSurface = UlwLoopToolkitSurface;

export interface ToolkitContext {
	readonly cwd: string;
	readonly sessionId: string;
	readonly surface: ToolkitSurface;
}

export type CreateGoalsArgs = Parameters<typeof createUlwLoopPlan>[1];
export type CompleteGoalsArgs = NonNullable<Parameters<typeof startNextUlwLoop>[1]>;
export type SteerArgs = UlwLoopSteeringProposal;
export type AddGoalArgs = Parameters<typeof addUlwLoopGoal>[1];
export type RecordEvidenceArgs = Parameters<typeof recordEvidence>[1];
export type CriteriaArgs = { readonly goalId: string };
export type CheckpointMutationArgs = CheckpointUlwLoopArgs & { readonly printTemplate?: false };
export type CheckpointTemplateArgs = { readonly printTemplate: true; readonly goalId?: string };
export type CheckpointArgs = CheckpointMutationArgs | CheckpointTemplateArgs;
export type RecordReviewBlockersArgs = Parameters<typeof recordFinalReviewBlockers>[1];

export type ToolkitDispatchRequest =
	| { readonly operation: "help"; readonly args?: Record<never, never> }
	| { readonly operation: "create-goals"; readonly args: CreateGoalsArgs }
	| { readonly operation: "status"; readonly args?: Record<never, never> }
	| { readonly operation: "complete-goals"; readonly args?: CompleteGoalsArgs }
	| { readonly operation: "checkpoint"; readonly args: CheckpointArgs }
	| { readonly operation: "steer"; readonly args: SteerArgs }
	| { readonly operation: "add-goal"; readonly args: AddGoalArgs }
	| { readonly operation: "criteria"; readonly args: CriteriaArgs }
	| { readonly operation: "record-evidence"; readonly args: RecordEvidenceArgs }
	| { readonly operation: "record-review-blockers"; readonly args: RecordReviewBlockersArgs };

export interface ToolkitUnknownRequest {
	readonly operation: string;
	readonly args?: Record<never, never>;
}

export interface ToolkitError {
	readonly code: string;
	readonly message: string;
	readonly details?: Readonly<Record<string, string>>;
}

export interface ToolkitSuccess<Operation extends UlwLoopOperation, Result> {
	readonly ok: true;
	readonly operation: Operation;
	readonly result: Result;
	readonly nextActions: readonly string[];
	readonly warnings?: readonly string[];
}

export interface ToolkitFailure<Operation extends string = string> {
	readonly ok: false;
	readonly operation: Operation;
	readonly error: ToolkitError;
}

type StatusResult = {
	readonly plan: UlwLoopPlan;
	readonly summary: ReturnType<typeof summarizeUlwLoopPlan>;
	readonly nextActions: readonly string[];
	readonly currentAttemptDir?: string;
};

type ResultFor<Operation extends UlwLoopOperation> = Operation extends "help"
	? typeof ULW_LOOP_MANIFEST
	: Operation extends "create-goals"
		? Awaited<ReturnType<typeof createUlwLoopPlan>>
		: Operation extends "status"
			? StatusResult
			: Operation extends "complete-goals"
				? Awaited<ReturnType<typeof startNextUlwLoop>>
				: Operation extends "checkpoint"
					? CheckpointUlwLoopResult | CheckpointTemplate
					: Operation extends "steer"
						? Awaited<ReturnType<typeof steerUlwLoop>>
						: Operation extends "add-goal"
							? Awaited<ReturnType<typeof addUlwLoopGoal>>
							: Operation extends "criteria"
								? {
										readonly goalId: string;
										readonly criteria: UlwLoopPlan["goals"][number]["successCriteria"];
									}
								: Operation extends "record-evidence"
									? Awaited<ReturnType<typeof recordEvidence>>
									: Operation extends "record-review-blockers"
										? Awaited<ReturnType<typeof recordFinalReviewBlockers>>
										: never;

export type ToolkitResultFor<Operation extends UlwLoopOperation> = ResultFor<Operation>;
export type ToolkitResponseFor<Operation extends UlwLoopOperation> =
	| ToolkitSuccess<Operation, ResultFor<Operation>>
	| ToolkitFailure<Operation>;
export type ToolkitOperationResponse = {
	[Operation in UlwLoopOperation]: ToolkitResponseFor<Operation>;
}[UlwLoopOperation];
export type ToolkitDispatchResponse = ToolkitOperationResponse | ToolkitFailure<string>;
export type ToolkitResponse<Result> = ToolkitSuccess<UlwLoopOperation, Result> | ToolkitFailure<string>;

export interface ToolkitOperationHookEvent<Operation extends UlwLoopOperation = UlwLoopOperation> {
	readonly operation: Operation;
	readonly context: ToolkitContext;
	readonly response: ToolkitResponseFor<Operation>;
}

export interface ToolkitHostHooks {
	readonly onOperation?: <Operation extends UlwLoopOperation>(
		event: ToolkitOperationHookEvent<Operation>,
	) => void | Promise<void>;
}

export interface AgentToolkitDependencies {
	readonly hooks?: ToolkitHostHooks;
}

export interface AgentToolkit {
	readonly dispatch: (request: ToolkitDispatchRequest | ToolkitUnknownRequest) => Promise<ToolkitDispatchResponse>;
	readonly help: () => Promise<ToolkitResponseFor<"help">>;
	readonly createGoals: (args: CreateGoalsArgs) => Promise<ToolkitResponseFor<"create-goals">>;
	readonly status: () => Promise<ToolkitResponseFor<"status">>;
	readonly completeGoals: (args?: CompleteGoalsArgs) => Promise<ToolkitResponseFor<"complete-goals">>;
	readonly checkpoint: (args: CheckpointArgs) => Promise<ToolkitResponseFor<"checkpoint">>;
	readonly steer: (args: SteerArgs) => Promise<ToolkitResponseFor<"steer">>;
	readonly addGoal: (args: AddGoalArgs) => Promise<ToolkitResponseFor<"add-goal">>;
	readonly criteria: (args: CriteriaArgs) => Promise<ToolkitResponseFor<"criteria">>;
	readonly recordEvidence: (args: RecordEvidenceArgs) => Promise<ToolkitResponseFor<"record-evidence">>;
	readonly recordReviewBlockers: (
		args: RecordReviewBlockersArgs,
	) => Promise<ToolkitResponseFor<"record-review-blockers">>;
}

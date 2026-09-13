import { checkpointUlwLoop } from "../checkpoint.js";
import { checkpointTemplate } from "../checkpoint-template.js";
import { recordEvidence } from "../evidence.js";
import { type UlwLoopScope, ulwLoopAttemptEvidenceDir } from "../paths.js";
import { addUlwLoopGoal, createUlwLoopPlan, startNextUlwLoop, summarizeUlwLoopPlan } from "../plan-crud.js";
import { readUlwLoopPlan } from "../plan-io.js";
import { recordFinalReviewBlockers } from "../review-blockers.js";
import { UlwLoopError } from "../runtime.js";
import { statusNextActions } from "../status-next-actions.js";
import { steerUlwLoop } from "../steering.js";
import type { UlwLoopOperation } from "./manifest.js";
import { ULW_LOOP_MANIFEST } from "./manifest.js";
import type {
	AgentToolkit,
	AgentToolkitDependencies,
	CheckpointArgs,
	ToolkitContext,
	ToolkitDispatchRequest,
	ToolkitDispatchResponse,
	ToolkitError,
	ToolkitFailure,
	ToolkitResponseFor,
	ToolkitResultFor,
	ToolkitUnknownRequest,
} from "./types.js";

// The SDK takes inline values only, so a snapshot that is not JSON is a caller error - normalize it
// to the same stable code the CLI reports instead of letting it surface as a generic failure.
function validateCodexGoalJson(raw: string | undefined): void {
	if (raw === undefined) return;
	try {
		JSON.parse(raw);
	} catch (error) {
		throw new UlwLoopError(
			`Invalid codexGoal: ${error instanceof Error ? error.message : "not valid JSON"}`,
			"ULW_LOOP_CODEX_GOAL_JSON_INVALID",
			{ cause: error },
		);
	}
}

function validateContext(context: ToolkitContext): void {
	if (!context.cwd.trim()) throw new UlwLoopError("cwd is required.", "ULW_LOOP_CWD_REQUIRED");
	if (!context.sessionId.trim())
		throw new UlwLoopError("ULW_LOOP_SESSION_ID_REQUIRED: sessionId is required.", "ULW_LOOP_SESSION_ID_REQUIRED");
	if (context.surface !== "omo-senpi" && context.surface !== "lazycodex")
		throw new UlwLoopError("surface must be omo-senpi or lazycodex.", "ULW_LOOP_SURFACE_INVALID");
}

function errorDetails(error: UlwLoopError): ToolkitError {
	const details =
		error.details === undefined
			? undefined
			: Object.fromEntries(Object.entries(error.details).map(([key, value]) => [key, String(value)]));
	return details === undefined
		? { code: error.code, message: error.message }
		: { code: error.code, message: error.message, details };
}

function failure<Operation extends string>(operation: Operation, error: UlwLoopError): ToolkitFailure<Operation> {
	return { ok: false, operation, error: errorDetails(error) };
}

function caught<Operation extends string>(operation: Operation, error: Error): ToolkitFailure<Operation> {
	return failure(operation, error instanceof UlwLoopError ? error : new UlwLoopError(error.message, "ULW_LOOP_ERROR"));
}

function isKnownRequest(request: ToolkitDispatchRequest | ToolkitUnknownRequest): request is ToolkitDispatchRequest {
	return ULW_LOOP_MANIFEST.operations.some((operation) => operation.name === request.operation);
}

function unreachable(value: never): never {
	throw new UlwLoopError(`Unhandled operation: ${String(value)}`, "ULW_LOOP_OPERATION_UNHANDLED");
}

function nextActionsFrom(result: object): readonly string[] {
	if (!("nextActions" in result) || !Array.isArray(result.nextActions)) return [];
	return result.nextActions.filter((action): action is string => typeof action === "string").slice(0, 8);
}

function checkpointWithValidatedSnapshot(
	context: ToolkitContext,
	scope: UlwLoopScope,
	args: Exclude<CheckpointArgs, { readonly printTemplate: true }>,
): ReturnType<typeof checkpointUlwLoop> {
	validateCodexGoalJson(args.codexGoalJson);
	return checkpointUlwLoop(context.cwd, args, scope, { surface: context.surface });
}

export function createAgentToolkit(context: ToolkitContext, deps: AgentToolkitDependencies = {}): AgentToolkit {
	validateContext(context);
	const scope: UlwLoopScope = { sessionId: context.sessionId };
	const notify = async <Operation extends UlwLoopOperation>(
		operation: Operation,
		response: ToolkitResponseFor<Operation>,
	): Promise<ToolkitResponseFor<Operation>> => {
		if (deps.hooks?.onOperation !== undefined) await deps.hooks.onOperation({ operation, context, response });
		return response;
	};
	const invoke = async <Operation extends UlwLoopOperation>(
		operation: Operation,
		fn: () => Promise<ToolkitResultFor<Operation>>,
	): Promise<ToolkitResponseFor<Operation>> => {
		try {
			const result = await fn();
			const nextActions = typeof result === "object" && result !== null ? nextActionsFrom(result) : [];
			return await notify(operation, { ok: true, operation, result, nextActions });
		} catch (error) {
			const response = caught(operation, error instanceof Error ? error : new Error("ULW_LOOP_ERROR"));
			return notify(operation, response);
		}
	};
	const toolkit: AgentToolkit = {
		dispatch: async (request): Promise<ToolkitDispatchResponse> => {
			if (!isKnownRequest(request))
				return failure(
					request.operation,
					new UlwLoopError(`Unknown operation: ${request.operation}`, "ULW_LOOP_OPERATION_UNKNOWN"),
				);
			switch (request.operation) {
				case "help":
					return toolkit.help();
				case "create-goals":
					return toolkit.createGoals(request.args);
				case "status":
					return toolkit.status();
				case "complete-goals":
					return toolkit.completeGoals(request.args);
				case "checkpoint":
					return toolkit.checkpoint(request.args);
				case "steer":
					return toolkit.steer(request.args);
				case "add-goal":
					return toolkit.addGoal(request.args);
				case "criteria":
					return toolkit.criteria(request.args);
				case "record-evidence":
					return toolkit.recordEvidence(request.args);
				case "record-review-blockers":
					return toolkit.recordReviewBlockers(request.args);
				default:
					return unreachable(request);
			}
		},
		help: () => invoke("help", async () => ULW_LOOP_MANIFEST),
		createGoals: (args) => invoke("create-goals", () => createUlwLoopPlan(context.cwd, args, scope)),
		status: () =>
			invoke("status", async () => {
				const plan = await readUlwLoopPlan(context.cwd, scope);
				const active = plan.goals.find((goal) => goal.id === plan.activeGoalId);
				return {
					plan,
					summary: summarizeUlwLoopPlan(plan),
					nextActions: statusNextActions(plan),
					// Attempt directories are an evidence-layout v2 concept; a v1 plan must not advertise one.
					...(active === undefined || plan.evidenceLayoutVersion !== 2
						? {}
						: { currentAttemptDir: ulwLoopAttemptEvidenceDir(active.id, active.attempt, scope) }),
				};
			}),
		completeGoals: (args = {}) => invoke("complete-goals", () => startNextUlwLoop(context.cwd, args, scope)),
		checkpoint: (args: CheckpointArgs) =>
			invoke("checkpoint", () =>
				args.printTemplate === true
					? checkpointTemplate(context.cwd, scope, args.goalId, { surface: context.surface })
					: checkpointWithValidatedSnapshot(context, scope, args),
			),
		steer: (args) => invoke("steer", () => steerUlwLoop(context.cwd, args, scope)),
		addGoal: (args) => invoke("add-goal", () => addUlwLoopGoal(context.cwd, args, scope)),
		criteria: (args) =>
			invoke("criteria", async () => {
				const plan = await readUlwLoopPlan(context.cwd, scope);
				const goal = plan.goals.find((candidate) => candidate.id === args.goalId);
				if (goal === undefined)
					throw new UlwLoopError(`Unknown ulw-loop id: ${args.goalId}.`, "ULW_LOOP_GOAL_NOT_FOUND");
				return { goalId: goal.id, criteria: goal.successCriteria };
			}),
		recordEvidence: (args) => invoke("record-evidence", () => recordEvidence(context.cwd, args, scope)),
		recordReviewBlockers: (args) =>
			invoke("record-review-blockers", () => recordFinalReviewBlockers(context.cwd, args, scope)),
	};
	return toolkit;
}

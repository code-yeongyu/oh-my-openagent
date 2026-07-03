import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "../../types.ts";
import { formatGoalToolResponse } from "./format.ts";
import { createGoal, readGoal, updateGoal } from "./store.ts";
import type { Goal, GoalAccountingMode, GoalStoreRef, TokenUsageSnapshot } from "./types.ts";
import { COMPLETABLE_GOAL_STATUS_VALUES } from "./types.ts";
import { updateGoalUi } from "./ui.ts";

const EMPTY_USAGE: TokenUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

type GoalToolResult = AgentToolResult<Record<string, never>>;

export type GoalToolRegistrationDeps = {
	readonly goalStoreRef: (ctx: ExtensionContext) => GoalStoreRef;
	readonly accountCurrentAgentTurn: (
		ctx: ExtensionContext,
		usage: TokenUsageSnapshot,
		mode: GoalAccountingMode,
	) => Promise<Goal | null>;
	readonly beginAgentGoalAccounting: (goal: Goal) => void;
	readonly markGoalCompletedThisTurn: (goal: Goal) => void;
};

export function registerGoalTools(pi: ExtensionAPI, deps: GoalToolRegistrationDeps): void {
	pi.registerTool({
		name: "create_goal",
		label: "Create Goal",
		description:
			"Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks.\nFails if a goal already exists; use update_goal only for status.",
		parameters: Type.Object(
			{
				objective: Type.String({
					description:
						"Required. The concrete objective to start pursuing. This starts a new active goal only when no goal is currently defined; if a goal already exists, this tool fails.",
				}),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const ref = deps.goalStoreRef(ctx);
			if ((await readGoal(ref)) !== null) {
				throw new Error(
					"cannot create a new goal because this thread already has a goal; use update_goal only when the existing goal is complete",
				);
			}
			const goal = await createGoal(ref, params.objective);
			deps.beginAgentGoalAccounting(goal);
			updateGoalUi(ctx, goal);
			return toolText(formatGoalToolResponse(goal));
		},
	});

	pi.registerTool({
		name: "update_goal",
		label: "Update Goal",
		description:
			"Update the existing goal.\nUse this tool only to mark the goal achieved.\nSet status to `complete` only when the objective has actually been achieved and no required work remains.\nDo not mark a goal complete merely because you are stopping work.\nYou cannot use this tool to pause or resume a goal; those status changes are controlled by the user or system.\nWhen marking the goal achieved with status `complete`, report the final elapsed time and token usage from the tool result to the user.",
		parameters: Type.Object(
			{
				status: Type.Union(
					COMPLETABLE_GOAL_STATUS_VALUES.map((status) => Type.Literal(status)),
					{
						description:
							"Required. Set to complete only when the objective is achieved and no required work remains.",
					},
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.status !== "complete") {
				throw new Error(
					"update_goal can only mark the existing goal complete; pause and resume are controlled by the user or system",
				);
			}
			await deps.accountCurrentAgentTurn(ctx, EMPTY_USAGE, "active");
			const goal = await updateGoal(deps.goalStoreRef(ctx), { status: "complete" });
			deps.markGoalCompletedThisTurn(goal);
			updateGoalUi(ctx, goal);
			return toolText(formatGoalToolResponse(goal));
		},
	});

	pi.registerTool({
		name: "get_goal",
		label: "Get Goal",
		description: "Get the current goal for this thread, including status, token and elapsed-time usage.",
		parameters: Type.Object({}, { additionalProperties: false }),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const goal = await readGoal(deps.goalStoreRef(ctx));
			updateGoalUi(ctx, goal);
			return toolText(formatGoalToolResponse(goal));
		},
	});
}

function toolText(text: string): GoalToolResult {
	return { content: [{ type: "text" as const, text }], details: {} };
}

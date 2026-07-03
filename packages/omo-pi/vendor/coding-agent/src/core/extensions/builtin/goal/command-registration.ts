import type { ExtensionAPI, ExtensionContext } from "../../types.ts";
import { parseGoalCommand } from "./command.ts";
import { formatGoalForTool, goalStatusLabel } from "./format.ts";
import { clearGoal, createGoal, readGoal, updateGoal } from "./store.ts";
import type { Goal, GoalAccountingMode, GoalStoreRef, TokenUsageSnapshot } from "./types.ts";
import { updateGoalUi } from "./ui.ts";

const GOAL_USAGE = "Usage: /goal <objective>";
const GOAL_EMPTY_HINT = "No goal is currently set.";
const REPLACE_GOAL_CHOICE = "Replace current goal";
const CANCEL_REPLACE_GOAL_CHOICE = "Cancel";
const EMPTY_USAGE: TokenUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

export type GoalCommandRegistrationDeps = {
	readonly goalStoreRef: (ctx: ExtensionContext) => GoalStoreRef;
	readonly accountCurrentAgentTurn: (
		ctx: ExtensionContext,
		usage: TokenUsageSnapshot,
		mode: GoalAccountingMode,
	) => Promise<Goal | null>;
	readonly beginAgentGoalAccounting: (goal: Goal) => void;
	readonly stopAgentGoalAccounting: (goalId: string) => void;
	readonly clearAgentGoalAccounting: () => void;
	readonly queueGoalContinuation: (pi: ExtensionAPI, ctx: ExtensionContext, goal: Goal) => void;
};

export function registerGoalCommand(pi: ExtensionAPI, deps: GoalCommandRegistrationDeps): void {
	pi.registerCommand("goal", {
		description: "Set, inspect, pause, resume, or clear the persistent goal",
		handler: async (rawArgs, ctx) => {
			const command = parseGoalCommand(rawArgs);
			try {
				switch (command.kind) {
					case "show": {
						const goal = await readGoal(deps.goalStoreRef(ctx));
						updateGoalUi(ctx, goal);
						ctx.ui.notify(
							goal === null ? `${GOAL_USAGE}\n${GOAL_EMPTY_HINT}` : formatGoalForTool(goal),
							goal ? "info" : "warning",
						);
						return;
					}
					case "setObjective": {
						await setGoalObjective(pi, ctx, command.objective, deps);
						return;
					}
					case "setStatus": {
						if (command.status === "paused") {
							await deps.accountCurrentAgentTurn(ctx, EMPTY_USAGE, "active");
						}
						const goal = await updateGoal(deps.goalStoreRef(ctx), { status: command.status });
						if (goal.status === "active") {
							deps.beginAgentGoalAccounting(goal);
						} else {
							deps.stopAgentGoalAccounting(goal.id);
						}
						updateGoalUi(ctx, goal);
						ctx.ui.notify(`Goal ${goalStatusLabel(goal.status)}\n${formatGoalForTool(goal)}`, "info");
						deps.queueGoalContinuation(pi, ctx, goal);
						return;
					}
					case "clear": {
						await deps.accountCurrentAgentTurn(ctx, EMPTY_USAGE, "active");
						const cleared = await clearGoal(deps.goalStoreRef(ctx));
						deps.clearAgentGoalAccounting();
						updateGoalUi(ctx, null);
						ctx.ui.notify(
							cleared ? "Goal cleared" : "No goal to clear\nThis thread does not currently have a goal.",
							cleared ? "info" : "warning",
						);
						return;
					}
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}

async function setGoalObjective(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	objective: string,
	deps: GoalCommandRegistrationDeps,
): Promise<void> {
	const ref = deps.goalStoreRef(ctx);
	const current = await readGoal(ref);
	if (current !== null) {
		const shouldReplace = await confirmReplaceGoal(ctx, objective);
		if (!shouldReplace) return;
	}

	if (current?.status === "active") {
		await deps.accountCurrentAgentTurn(ctx, EMPTY_USAGE, "active");
	}
	const goal = current === null ? await createGoal(ref, objective) : await updateGoal(ref, { objective });
	if (goal.status === "active") deps.beginAgentGoalAccounting(goal);
	updateGoalUi(ctx, goal);
	ctx.ui.notify(`Goal ${goalStatusLabel(goal.status)}\n${formatGoalForTool(goal)}`, "info");
	deps.queueGoalContinuation(pi, ctx, goal);
}

async function confirmReplaceGoal(ctx: ExtensionContext, objective: string): Promise<boolean> {
	if (!ctx.hasUI) return true;
	const choice = await ctx.ui.select(`Replace goal?\nNew objective: ${objective}`, [
		REPLACE_GOAL_CHOICE,
		CANCEL_REPLACE_GOAL_CHOICE,
	]);
	return choice === REPLACE_GOAL_CHOICE;
}

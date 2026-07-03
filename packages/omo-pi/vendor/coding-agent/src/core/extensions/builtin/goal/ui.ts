import type { ExtensionContext } from "../../types.ts";
import { formatGoalElapsedSeconds } from "./format.ts";
import type { Goal } from "./types.ts";

export const STATUS_KEY = "goal";

export function updateGoalUi(ctx: ExtensionContext, goal: Goal | null): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, goal === null ? undefined : goalStatusText(goal));
}

export function goalStatusText(goal: Goal): string {
	switch (goal.status) {
		case "active":
			return goal.timeUsedSeconds > 0
				? `Pursuing goal (${formatGoalElapsedSeconds(goal.timeUsedSeconds)})`
				: "Pursuing goal";
		case "paused":
			return "Goal paused (/goal resume)";
		case "complete":
			return "Goal achieved";
	}
}

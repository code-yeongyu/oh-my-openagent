import { describe, expect, it } from "bun:test";

import { formatGoalElapsedSeconds, goalToolResponse, goalUsageSummary } from "../src/goal/format.js";
import type { Goal } from "../src/goal/types.js";

describe("goal display formatting", () => {
	it("formats elapsed seconds like Codex TUI", () => {
		expect(formatGoalElapsedSeconds(0)).toBe("0s");
		expect(formatGoalElapsedSeconds(59)).toBe("59s");
		expect(formatGoalElapsedSeconds(60)).toBe("1m");
		expect(formatGoalElapsedSeconds(30 * 60)).toBe("30m");
		expect(formatGoalElapsedSeconds(90 * 60)).toBe("1h 30m");
		expect(formatGoalElapsedSeconds(2 * 60 * 60)).toBe("2h");
		expect(formatGoalElapsedSeconds(24 * 60 * 60 - 1)).toBe("23h 59m");
		expect(formatGoalElapsedSeconds(24 * 60 * 60)).toBe("1d 0h 0m");
		expect(formatGoalElapsedSeconds(2 * 24 * 60 * 60 + 23 * 60 * 60 + 42 * 60)).toBe("2d 23h 42m");
	});

	it("summarizes goal time and budgeted tokens", () => {
		expect(goalUsageSummary(testGoal({ tokenBudget: 50_000, tokensUsed: 63_876 }))).toBe(
			"Objective: Port /goal as a pi extension Time: 2m. Tokens: 63.9K/50K.",
		);
	});

	it("returns Codex-style tool response budget report for completed budgeted goals", () => {
		expect(
			goalToolResponse(
				testGoal({
					status: "complete",
					tokenBudget: 10_000,
					tokensUsed: 3_250,
					timeUsedSeconds: 75,
				}),
				true,
			),
		).toMatchObject({
			goal: {
				threadId: "thread-1",
				status: "complete",
				tokenBudget: 10_000,
				createdAt: 1_777_766_400,
			},
			remainingTokens: 6_750,
			completionBudgetReport:
				"Goal achieved. Report final usage from this tool result's structured goal fields. If `goal.tokenBudget` is present, include token usage from `goal.tokensUsed` and `goal.tokenBudget`. If `goal.timeUsedSeconds` is greater than 0, summarize elapsed time in a concise, human-friendly form appropriate to the response language.",
		});
	});
});

function testGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		threadId: "thread-1",
		objective: "Port /goal as a pi extension",
		status: "active",
		tokensUsed: 0,
		timeUsedSeconds: 120,
		createdAt: 1_777_766_400,
		updatedAt: 1_777_766_400,
		...overrides,
	};
}

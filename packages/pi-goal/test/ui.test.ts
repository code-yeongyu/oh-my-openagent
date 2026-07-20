import { describe, expect, it } from "bun:test";
import type { Goal } from "../src/goal/types.js";
import { composeFooterStatusLine, goalFooterIndicator } from "../src/goal/ui.js";

describe("goal footer UI", () => {
	it("formats Codex-style goal indicator labels", () => {
		expect(goalFooterIndicator(testGoal()).text).toBe("Pursuing goal (2m)");
		expect(goalFooterIndicator(testGoal({ tokenBudget: 50_000, tokensUsed: 12_500 })).text).toBe(
			"Pursuing goal (12.5K / 50K)",
		);
		expect(goalFooterIndicator(testGoal({ status: "paused" })).text).toBe("Goal paused (/goal resume)");
		expect(
			goalFooterIndicator(testGoal({ status: "budgetLimited", tokenBudget: 50_000, tokensUsed: 63_876 })).text,
		).toBe("Goal unmet (63.9K / 50K tokens)");
		expect(goalFooterIndicator(testGoal({ status: "complete", tokenBudget: 10_000, tokensUsed: 3_250 })).text).toBe(
			"Goal achieved (3.3K tokens)",
		);
	});

	it("right-aligns the goal indicator on the bottom footer line", () => {
		const line = composeFooterStatusLine("", "Pursuing goal (2m)", 32);

		expect(line).toHaveLength(32);
		expect(line.endsWith("Pursuing goal (2m)")).toBe(true);
		expect(line.trimStart()).toBe("Pursuing goal (2m)");
	});

	it("keeps other extension statuses on the left when the goal indicator fits", () => {
		const line = composeFooterStatusLine("review ready", "Goal paused (/goal resume)", 52);

		expect(line).toHaveLength(52);
		expect(line.startsWith("review ready")).toBe(true);
		expect(line.endsWith("Goal paused (/goal resume)")).toBe(true);
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

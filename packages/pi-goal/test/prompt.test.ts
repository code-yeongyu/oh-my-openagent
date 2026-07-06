import { describe, expect, it } from "bun:test";

import { buildBudgetLimitedPrompt, buildContinuationPrompt } from "../src/goal/prompt.js";
import type { Goal } from "../src/goal/types.js";

describe("goal prompts", () => {
	it("renders the codex continuation prompt structure with an escaped objective", () => {
		const prompt = buildContinuationPrompt(testGoal("A & B < C > D", { tokenBudget: 100 }));

		expect(prompt.startsWith("Continue working toward the active thread goal.")).toBe(true);
		expect(prompt).toContain("<objective>\nA &amp; B &lt; C &gt; D\n</objective>");
		expect(prompt).not.toContain("<untrusted_objective>");

		for (const marker of [
			"Continuation behavior:",
			"Work from evidence:",
			"Progress visibility:",
			"Fidelity:",
			"Completion audit:",
			"Blocked audit:",
		]) {
			expect(prompt).toContain(marker);
		}

		expect(prompt).toContain("- Tokens used: 10");
		expect(prompt).toContain("- Token budget: 100");
		expect(prompt).toContain("- Tokens remaining: 90");
		expect(prompt).not.toContain("- Time spent pursuing goal:");
		expect(prompt).toContain('call update_goal with status "complete"');
		expect(prompt).toContain('status "blocked"');
	});

	it("renders unbounded token budget fields when no budget is set", () => {
		const prompt = buildContinuationPrompt(testGoal("Objective", { tokensUsed: 7 }));

		expect(prompt).toContain("- Tokens used: 7");
		expect(prompt).toContain("- Token budget: none");
		expect(prompt).toContain("- Tokens remaining: unbounded");
	});

	it("renders the codex budget-limit prompt structure with an escaped objective", () => {
		const prompt = buildBudgetLimitedPrompt(
			testGoal("A & B < C > D", { status: "budgetLimited", tokenBudget: 10, tokensUsed: 12 }),
		);

		expect(prompt.startsWith("The active thread goal has reached its token budget.")).toBe(true);
		expect(prompt).toContain("<objective>\nA &amp; B &lt; C &gt; D\n</objective>");
		expect(prompt).not.toContain("<untrusted_objective>");
		expect(prompt).toContain("- Time spent pursuing goal: 20 seconds");
		expect(prompt).toContain("- Tokens used: 12");
		expect(prompt).toContain("- Token budget: 10");
		expect(prompt).toContain("budget_limited");
		expect(prompt).toContain("Do not call update_goal unless the goal is actually complete.");
	});
});

function testGoal(objective: string, overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		threadId: "thread-1",
		objective,
		status: "active",
		tokensUsed: 10,
		timeUsedSeconds: 20,
		createdAt: 1_777_766_400,
		updatedAt: 1_777_766_400,
		...overrides,
	};
}

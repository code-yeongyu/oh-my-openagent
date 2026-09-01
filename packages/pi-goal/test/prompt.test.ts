import { describe, expect, it } from "bun:test";

import { buildBudgetLimitedPrompt, buildContinuationPrompt } from "../src/goal/prompt.js";
import type { Goal } from "../src/goal/types.js";

describe("goal prompts", () => {
	it("escapes the continuation objective at its data boundary", () => {
		const prompt = buildContinuationPrompt(testGoal("A & B < C > D", { tokenBudget: 100 }));

		expect(prompt).toContain("<objective>\nA &amp; B &lt; C &gt; D\n</objective>");
		expect(prompt).not.toContain("<untrusted_objective>");
	});

	it("reflects token accounting inputs without pinning their presentation", () => {
		const baseline = buildContinuationPrompt(testGoal("Objective", { tokensUsed: 7 }));
		const changedUsage = buildContinuationPrompt(testGoal("Objective", { tokensUsed: 8 }));
		const bounded = buildContinuationPrompt(testGoal("Objective", { tokensUsed: 7, tokenBudget: 100 }));

		expect(changedUsage).not.toBe(baseline);
		expect(bounded).not.toBe(baseline);
	});

	it("escapes budget-limit objectives and reflects accounting inputs", () => {
		const prompt = buildBudgetLimitedPrompt(
			testGoal("A & B < C > D", { status: "budgetLimited", tokenBudget: 10, tokensUsed: 12 }),
		);
		const changedAccounting = buildBudgetLimitedPrompt(
			testGoal("A & B < C > D", {
				status: "budgetLimited",
				tokenBudget: 11,
				tokensUsed: 13,
				timeUsedSeconds: 21,
			}),
		);

		expect(prompt).toContain("<objective>\nA &amp; B &lt; C &gt; D\n</objective>");
		expect(prompt).not.toContain("<untrusted_objective>");
		expect(changedAccounting).not.toBe(prompt);
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

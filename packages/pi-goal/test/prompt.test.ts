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

	it("embeds a session-goal anchor with original and current objectives in continuation prompts", () => {
		const prompt = buildContinuationPrompt(
			testGoal("Narrowed subtask", {
				originalObjective: "Full original request",
				deliverables: [{ text: "first artifact" }, { text: "second artifact" }],
			}),
		);

		expect(prompt).toContain("<session-goal>");
		expect(prompt).toContain("Full original request");
		expect(prompt).toContain("Narrowed subtask");
		expect(prompt).toContain("first artifact");
		expect(prompt).toContain("second artifact");
	});

	it("escapes session-goal anchor content at its data boundary", () => {
		const prompt = buildContinuationPrompt(testGoal("A < B", { originalObjective: "X & Y < Z" }));

		expect(prompt).toContain("X &amp; Y &lt; Z");
	});

	it("falls back to the current objective as the original for version-1 goals without one", () => {
		const prompt = buildContinuationPrompt(testGoal("Legacy only"));

		expect(prompt).toContain("<session-goal>");
		expect(prompt).toContain("Legacy only");
	});

	it("embeds the session-goal anchor in budget-limited prompts", () => {
		const prompt = buildBudgetLimitedPrompt(
			testGoal("Current objective", { status: "budgetLimited", originalObjective: "Original objective" }),
		);

		expect(prompt).toContain("<session-goal>");
		expect(prompt).toContain("Original objective");
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

import { describe, expect, it } from "bun:test";

import {
	shouldQueueGoalContinuationAfterAgentEnd,
	shouldQueueGoalContinuationWhenIdle,
} from "../src/goal/continuation.js";
import type { Goal } from "../src/goal/types.js";

const cleanTurn = [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] }];

describe("goal continuation policy", () => {
	it("continues an active goal after a clean agent turn when no user work is pending", () => {
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), false, cleanTurn)).toBe(true);
	});

	it("does not continue after an agent turn when another message is already pending", () => {
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), true, cleanTurn)).toBe(false);
	});

	it("only auto-continues active goals after an agent turn", () => {
		expect(shouldQueueGoalContinuationAfterAgentEnd(null, false, cleanTurn)).toBe(false);
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "paused" }), false, cleanTurn)).toBe(false);
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "budgetLimited" }), false, cleanTurn)).toBe(
			false,
		);
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "complete" }), false, cleanTurn)).toBe(false);
	});

	it("does not continue after a turn that ended with a provider error", () => {
		const erroredTurn = [
			{ role: "assistant", stopReason: "error", errorMessage: "boom", content: [] },
		];
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), false, erroredTurn)).toBe(false);
	});

	it("does not continue after a turn whose last tool result was aborted", () => {
		const abortedTurn = [
			{ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "1", name: "bash" }] },
			{ role: "toolResult", isError: true, content: [{ type: "text", text: "Aborted by user" }] },
		];
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), false, abortedTurn)).toBe(false);
	});

	it("continues after a turn whose tool failed for a non-abort reason", () => {
		const toolFailureTurn = [
			{ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "1", name: "bash" }] },
			{ role: "toolResult", isError: true, content: [{ type: "text", text: "command not found" }] },
			{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "recovered" }] },
		];
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), false, toolFailureTurn)).toBe(
			true,
		);
	});

	it("requires idle state for command and session-start continuation", () => {
		expect(shouldQueueGoalContinuationWhenIdle(testGoal({ status: "active" }), true, false)).toBe(true);
		expect(shouldQueueGoalContinuationWhenIdle(testGoal({ status: "active" }), false, false)).toBe(false);
		expect(shouldQueueGoalContinuationWhenIdle(testGoal({ status: "active" }), true, true)).toBe(false);
	});
});

function testGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		threadId: "thread-1",
		objective: "Keep going until complete",
		status: "active",
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 1_777_766_400,
		updatedAt: 1_777_766_400,
		...overrides,
	};
}

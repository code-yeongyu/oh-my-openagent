import { describe, expect, it } from "bun:test";

import {
	shouldQueueGoalContinuationAfterAgentEnd,
	shouldQueueGoalContinuationWhenIdle,
} from "../src/goal/continuation.js";
import type { Goal } from "../src/goal/types.js";

describe("goal continuation policy", () => {
	it("continues an active goal after each agent turn when no user work is pending", () => {
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), false)).toBe(true);
	});

	it("does not continue after an agent turn when another message is already pending", () => {
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "active" }), true)).toBe(false);
	});

	it("only auto-continues active goals after an agent turn", () => {
		expect(shouldQueueGoalContinuationAfterAgentEnd(null, false)).toBe(false);
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "paused" }), false)).toBe(false);
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "budgetLimited" }), false)).toBe(false);
		expect(shouldQueueGoalContinuationAfterAgentEnd(testGoal({ status: "complete" }), false)).toBe(false);
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

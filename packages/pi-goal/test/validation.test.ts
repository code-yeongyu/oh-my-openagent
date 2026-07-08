import { describe, expect, it } from "bun:test";

import { MAX_OBJECTIVE_LENGTH, validateObjective } from "../src/goal/validation.js";

describe("validateObjective", () => {
	it("accepts objective when at Codex character limit", () => {
		const objective = "a".repeat(MAX_OBJECTIVE_LENGTH);

		expect(validateObjective(objective)).toBe(objective);
	});

	it("throws Codex-style file hint when objective exceeds limit", () => {
		const objective = "a".repeat(MAX_OBJECTIVE_LENGTH + 1);

		expect(() => validateObjective(objective)).toThrow("Put longer instructions in a file");
	});
});

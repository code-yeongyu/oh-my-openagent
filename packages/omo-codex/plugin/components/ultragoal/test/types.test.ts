import { describe, expect, it } from "vitest";

import {
	iso,
	ULTRAGOAL_BRIEF,
	ULTRAGOAL_CRITERION_STATUSES,
	ULTRAGOAL_DIR,
	ULTRAGOAL_GOALS,
	ULTRAGOAL_LEDGER,
	ULTRAGOAL_STEERING_MUTATION_KINDS,
	ULTRAGOAL_SUCCESS_CRITERION_USER_MODELS,
	UltragoalError,
} from "../src/types.ts";

describe("ultragoal domain constants", () => {
	describe("when checking workspace paths", () => {
		it("then ULTRAGOAL_DIR points to the omo workspace", () => {
			expect(ULTRAGOAL_DIR).toBe(".omo/ultragoal");
		});

		it("then artifact filenames are stable", () => {
			expect(ULTRAGOAL_BRIEF).toBe("brief.md");
			expect(ULTRAGOAL_GOALS).toBe("goals.json");
			expect(ULTRAGOAL_LEDGER).toBe("ledger.jsonl");
		});
	});

	describe("when checking steering mutation kinds", () => {
		it("then includes the new revise_criterion kind", () => {
			expect(ULTRAGOAL_STEERING_MUTATION_KINDS).toContain("revise_criterion");
		});

		it("then totals 7 kinds", () => {
			expect(ULTRAGOAL_STEERING_MUTATION_KINDS).toHaveLength(7);
		});
	});

	describe("when checking criterion user models", () => {
		it("then exposes 4 user models including adversarial", () => {
			expect(ULTRAGOAL_SUCCESS_CRITERION_USER_MODELS).toEqual(["happy", "edge", "regression", "adversarial"]);
		});
	});

	describe("when checking criterion statuses", () => {
		it("then exposes pending/pass/fail/blocked", () => {
			expect(ULTRAGOAL_CRITERION_STATUSES).toEqual(["pending", "pass", "fail", "blocked"]);
		});
	});
});

describe("UltragoalError", () => {
	describe("when constructed with code", () => {
		it("then is an Error instance carrying the code", () => {
			const err = new UltragoalError("bad", "TEST_CODE");

			expect(err).toBeInstanceOf(Error);
			expect(err.code).toBe("TEST_CODE");
			expect(err.message).toBe("bad");
		});

		it("then accepts optional cause + details", () => {
			const cause = new Error("upstream");
			const err = new UltragoalError("wrap", "WRAP", { cause, details: { goalId: "G001" } });

			expect(err.cause).toBe(cause);
			expect(err.details).toEqual({ goalId: "G001" });
		});
	});
});

describe("iso()", () => {
	describe("when called", () => {
		it("then returns an ISO 8601 string", () => {
			const s = iso();

			expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		});
	});
});
